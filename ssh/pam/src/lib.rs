//! Linux-PAM authentication adapter. No HTTP, signature, or RPC decisions here.
// Linux-PAM calls this module through its C ABI.
#![allow(unsafe_code)]
use auth_core::{
    protocol::{Request, Response},
    unix_time, MAX_FRAME, TTL_SECONDS, TTL_SECONDS_I64, VERSION,
};
use libc::{c_char, c_int, c_void};
use std::{
    ffi::{CStr, CString},
    io::{BufRead, BufReader, Read, Write},
    os::{
        fd::AsRawFd,
        unix::{
            fs::{FileTypeExt, MetadataExt},
            net::UnixStream,
        },
    },
    panic::{catch_unwind, AssertUnwindSafe},
    time::Duration,
};

const PAM_SUCCESS: c_int = 0;
const PAM_SERVICE_ERR: c_int = 3;
const PAM_AUTH_ERR: c_int = 7;
const PAM_CONV: c_int = 5;
const PAM_PROMPT_ECHO_ON: c_int = 2;
const PAM_TEXT_INFO: c_int = 4;
type ConvFn = unsafe extern "C" fn(
    c_int,
    *mut *const PamMessage,
    *mut *mut PamResponse,
    *mut c_void,
) -> c_int;

/// Light terminal foreground forms the light cells; spaces form dark cells.
/// A full quiet zone keeps the code scannable on a dark terminal background.
fn qr_rows(url: &str) -> Option<Vec<String>> {
    use qrcode::{Color, EcLevel, QrCode};
    let code = QrCode::with_error_correction_level(url.as_bytes(), EcLevel::M).ok()?;
    let width = code.width() + 8;
    if width > 80 {
        return None;
    }
    let light = |x: usize, y: usize| {
        x < 4 || y < 4 || x >= width - 4 || y >= width - 4 || code[(x - 4, y - 4)] == Color::Light
    };
    Some(
        (0..width)
            .step_by(2)
            .map(|y| {
                let mut row = String::with_capacity(width * 3 + 1);
                for x in 0..width {
                    row.push(match (light(x, y), y + 1 >= width || light(x, y + 1)) {
                        (true, true) => '█',
                        (true, false) => '▀',
                        (false, true) => '▄',
                        (false, false) => ' ',
                    });
                }
                row.push('\n');
                row
            })
            .collect(),
    )
}

/// Sends one message through the application's PAM conversation.
///
/// # Safety
/// `callback` and `appdata` must be the conversation Linux-PAM supplied for the current handle.
unsafe fn conversation_message(
    callback: ConvFn,
    appdata: *mut c_void,
    style: c_int,
    text: &str,
) -> Result<(), ()> {
    let text = CString::new(text).map_err(|_| ())?;
    let message = PamMessage {
        msg_style: style,
        msg: text.as_ptr(),
    };
    let mut message_ptr = &message as *const PamMessage;
    let mut response: *mut PamResponse = std::ptr::null_mut();
    // SAFETY: the caller guarantees the conversation; `message_ptr` points at one
    // live message whose text outlives the call, and `response` is a writable out-pointer.
    let status = unsafe { callback(1, &mut message_ptr, &mut response, appdata) };
    if !response.is_null() {
        // SAFETY: the conversation malloc'd one response and its text (either may be
        // null for free) and handed ownership to this module, which frees each once.
        unsafe {
            libc::free((*response).resp.cast());
            libc::free(response.cast());
        }
    }
    if status == PAM_SUCCESS {
        Ok(())
    } else {
        Err(())
    }
}

#[repr(C)]
struct PamMessage {
    msg_style: c_int,
    msg: *const c_char,
}
#[repr(C)]
struct PamResponse {
    resp: *mut c_char,
    resp_retcode: c_int,
}
type Conversation = unsafe extern "C" fn(
    c_int,
    *mut *const PamMessage,
    *mut *mut PamResponse,
    *mut c_void,
) -> c_int;
#[repr(C)]
struct PamConv {
    conv: Option<Conversation>,
    appdata_ptr: *mut c_void,
}

#[link(name = "pam")]
unsafe extern "C" {
    fn pam_get_user(pamh: *mut c_void, user: *mut *const c_char, prompt: *const c_char) -> c_int;
    fn pam_get_item(pamh: *const c_void, item_type: c_int, item: *mut *const c_void) -> c_int;
}

fn read_response(reader: &mut BufReader<UnixStream>) -> Result<Response, ()> {
    let mut frame = Vec::new();
    reader
        .take((MAX_FRAME + 1) as u64)
        .read_until(b'\n', &mut frame)
        .map_err(|_| ())?;
    if frame.len() > MAX_FRAME || frame.last() != Some(&b'\n') {
        return Err(());
    }
    serde_json::from_slice(&frame).map_err(|_| ())
}

fn send(stream: &mut UnixStream, message: &Request) -> Result<(), ()> {
    let mut data = serde_json::to_vec(message).map_err(|_| ())?;
    data.push(b'\n');
    stream.write_all(&data).map_err(|_| ())
}

fn connect(path: &str) -> Result<UnixStream, ()> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| ())?;
    if !meta.file_type().is_socket() || meta.uid() != 0 || meta.mode() & 0o077 != 0 {
        return Err(());
    }
    let stream = UnixStream::connect(path).map_err(|_| ())?;
    // SAFETY: ucred is three integers, for which all zeros is a valid value.
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let expected = libc::socklen_t::try_from(std::mem::size_of::<libc::ucred>()).map_err(|_| ())?;
    let mut size = expected;
    // SAFETY: the descriptor is the socket `stream` owns, and `cred` and `size`
    // are a writable ucred and its length.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut size,
        )
    };
    if result != 0 || size != expected || cred.uid != 0 {
        return Err(());
    }
    stream
        .set_read_timeout(Some(Duration::from_secs(TTL_SECONDS + 5)))
        .map_err(|_| ())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| ())?;
    Ok(stream)
}

/// Shows the signing link and its QR code through the application's conversation.
///
/// # Safety
/// `pamh` must be the valid handle Linux-PAM passed to this module.
unsafe fn prompt(pamh: *mut c_void, url: &str) -> Result<(), ()> {
    if url.len() > 2048
        || url.chars().any(|c| c.is_control())
        || !(url.starts_with("https://") || url.starts_with("http://"))
    {
        return Err(());
    }
    let mut item: *const c_void = std::ptr::null();
    // SAFETY: the caller guarantees `pamh`, and `item` is a writable out-pointer.
    if unsafe { pam_get_item(pamh, PAM_CONV, &mut item) } != PAM_SUCCESS || item.is_null() {
        return Err(());
    }
    // SAFETY: Linux-PAM stores the application's `struct pam_conv` as PAM_CONV,
    // and it stays valid for as long as the handle.
    let conv = unsafe { &*item.cast::<PamConv>() };
    let callback = conv.conv.ok_or(())?;
    let appdata = conv.appdata_ptr;
    // SAFETY: `callback` and `appdata` are this handle's conversation, read just above.
    let say = |style, text: &str| unsafe { conversation_message(callback, appdata, style, text) };
    if let Some(rows) = qr_rows(url) {
        say(
            PAM_TEXT_INFO,
            "Scan this code on your phone, or open the link below:\n",
        )?;
        for row in rows {
            // Each information message stays below Linux-PAM's 512-byte limit.
            // OpenSSH adds a newline to each information message itself.
            say(PAM_TEXT_INFO, row.trim_end_matches('\n'))?;
        }
    }
    say(
        PAM_PROMPT_ECHO_ON,
        &format!("Open {url} and sign with your wallet.\nPress Enter after signing: "),
    )
}

/// A challenge must still be open and may not outlive the contract lifetime.
fn challenge_window_ok(expires_at: i64, now: i64) -> bool {
    expires_at > now && expires_at <= now + TTL_SECONDS_I64
}

/// # Safety
/// The same contract as [`pam_sm_authenticate`].
unsafe fn authenticate(
    pamh: *mut c_void,
    argc: c_int,
    argv: *const *const c_char,
) -> Result<(), ()> {
    if pamh.is_null() || !(0..=1).contains(&argc) || (argc != 0 && argv.is_null()) {
        return Err(());
    }
    let mut socket = "/run/solana-authd.sock";
    if argc == 1 {
        // SAFETY: `argv` is non-null and Linux-PAM passes `argc` (here one) pointers in it.
        let argument = unsafe { *argv };
        if argument.is_null() {
            return Err(());
        }
        // SAFETY: a module argument is a NUL-terminated string owned by Linux-PAM.
        socket = unsafe { CStr::from_ptr(argument) }
            .to_str()
            .map_err(|_| ())?
            .strip_prefix("socket=")
            .ok_or(())?;
        if !socket.starts_with('/') {
            return Err(());
        }
    }
    let mut user: *const c_char = std::ptr::null();
    // SAFETY: `pamh` is the non-null handle from Linux-PAM, `user` is a writable
    // out-pointer, and a null prompt selects Linux-PAM's default.
    if unsafe { pam_get_user(pamh, &mut user, std::ptr::null()) } != PAM_SUCCESS || user.is_null() {
        return Err(());
    }
    // SAFETY: pam_get_user succeeded, so `user` is a NUL-terminated name owned by the handle.
    let user = unsafe { CStr::from_ptr(user) }.to_str().map_err(|_| ())?;
    if user.len() > 32 {
        return Err(());
    }
    let mut stream = connect(socket)?;
    send(
        &mut stream,
        &Request::Start {
            version: VERSION,
            unix_user: user.into(),
        },
    )?;
    let mut reader = BufReader::new(stream);
    let Response::Challenge {
        version: VERSION,
        url,
        expires_at,
    } = read_response(&mut reader)?
    else {
        return Err(());
    };
    if !challenge_window_ok(expires_at, unix_time()) {
        return Err(());
    }
    // SAFETY: `pamh` is the handle Linux-PAM passed to this module.
    if unsafe { prompt(pamh, &url) }.is_err() {
        let _ = send(reader.get_mut(), &Request::Cancel { version: VERSION });
        return Err(());
    }
    if unix_time() >= expires_at {
        return Err(());
    }
    send(reader.get_mut(), &Request::Wait { version: VERSION })?;
    // OpenSSH may wait synchronously for PAM after a keyboard-interactive reply.
    // Periodic conversation checks let it observe a disconnected SSH client
    // instead of keeping the PAM worker/socket alive until the full deadline.
    loop {
        let mut descriptor = libc::pollfd {
            fd: reader.get_ref().as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: `descriptor` is one initialized pollfd for the open daemon socket.
        let ready = unsafe { libc::poll(&mut descriptor, 1, 1000) };
        if ready < 0 || unix_time() >= expires_at {
            return Err(());
        }
        if ready > 0 {
            break;
        }
        // SAFETY: `pamh` is the handle Linux-PAM passed to this module.
        if unsafe { prompt(pamh, &url) }.is_err() {
            let _ = send(reader.get_mut(), &Request::Cancel { version: VERSION });
            return Err(());
        }
    }
    match read_response(&mut reader)? {
        Response::Result {
            version: VERSION,
            allow: true,
            ..
        } if unix_time() < expires_at => Ok(()),
        _ => Err(()),
    }
}

/// Linux-PAM authentication entry point.
///
/// # Safety
/// Linux-PAM must supply a valid handle and `argc` valid C-string pointers in `argv`.
#[no_mangle]
pub unsafe extern "C" fn pam_sm_authenticate(
    pamh: *mut c_void,
    _flags: c_int,
    argc: c_int,
    argv: *const *const c_char,
) -> c_int {
    // SAFETY: the arguments are forwarded unchanged under this function's contract.
    match catch_unwind(AssertUnwindSafe(|| unsafe {
        authenticate(pamh, argc, argv)
    })) {
        Ok(Ok(())) => PAM_SUCCESS,
        Ok(Err(())) => PAM_AUTH_ERR,
        Err(_) => PAM_SERVICE_ERR,
    }
}

/// Authentication creates no Unix credentials; Linux-PAM retains its normal stack.
///
/// # Safety
/// Called by Linux-PAM with its standard module ABI.
#[no_mangle]
pub unsafe extern "C" fn pam_sm_setcred(
    _pamh: *mut c_void,
    _flags: c_int,
    _argc: c_int,
    _argv: *const *const c_char,
) -> c_int {
    PAM_SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_qr_decodes_to_the_exact_signing_url() {
        let url = format!("https://auth.example/v1/sessions/{}", "ab".repeat(32));
        let rows = qr_rows(&url).unwrap();
        let width = rows[0].trim_end_matches('\n').chars().count();
        assert!(width <= 80);
        assert!(rows.iter().all(|row| row.len() < 512));
        let scale = 4;
        let height = rows.len() * 2;
        let mut pixels = vec![255u8; width * height * scale * scale];
        for (row, text) in rows.iter().enumerate() {
            for (column, character) in text.trim_end_matches('\n').chars().enumerate() {
                let dark = match character {
                    '█' => [false, false],
                    '▀' => [false, true],
                    '▄' => [true, false],
                    ' ' => [true, true],
                    _ => panic!("unexpected QR character"),
                };
                for (half, dark) in dark.into_iter().enumerate() {
                    if dark {
                        for dy in 0..scale {
                            for dx in 0..scale {
                                pixels[((row * 2 + half) * scale + dy) * width * scale
                                    + column * scale
                                    + dx] = 0;
                            }
                        }
                    }
                }
            }
        }
        let mut image =
            rqrr::PreparedImage::prepare_from_greyscale(width * scale, height * scale, |x, y| {
                pixels[y * width * scale + x]
            });
        let grids = image.detect_grids();
        assert_eq!(grids.len(), 1);
        assert_eq!(grids[0].decode().unwrap().1, url);
        assert!(qr_rows(&format!("https://example.com/{}", "a".repeat(1800))).is_none());
    }
    #[test]
    fn challenge_window_matches_the_five_minute_contract() {
        assert_eq!(TTL_SECONDS, 300);
        assert!(challenge_window_ok(1300, 1000));
        assert!(challenge_window_ok(1001, 1000));
        assert!(!challenge_window_ok(1301, 1000));
        assert!(!challenge_window_ok(1000, 1000));
        assert!(!challenge_window_ok(999, 1000));
    }

    #[test]
    fn invalid_handle_fails_closed() {
        assert_eq!(
            // SAFETY: a null handle is the case under test; it is rejected before any use.
            unsafe { pam_sm_authenticate(std::ptr::null_mut(), 0, 0, std::ptr::null()) },
            PAM_AUTH_ERR
        );
    }
    #[test]
    fn response_parser_requires_complete_bounded_frame() {
        for data in [
            b"{\"op\":\"result\",\"version\":1,\"allow\":true,\"reason\":\"ok\"}".to_vec(),
            vec![b'x'; MAX_FRAME + 1],
        ] {
            let (mut server, client) = UnixStream::pair().unwrap();
            server.write_all(&data).unwrap();
            drop(server);
            assert!(read_response(&mut BufReader::new(client)).is_err());
        }
    }
}
