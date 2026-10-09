//! Linux-PAM authentication adapter. No HTTP, signature, or RPC decisions here.
use auth_core::{
    protocol::{Request, Response},
    unix_time, MAX_FRAME, TTL_SECONDS, VERSION,
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
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut size = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut size,
        )
    };
    if result != 0 || size as usize != std::mem::size_of::<libc::ucred>() || cred.uid != 0 {
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

unsafe fn prompt(pamh: *mut c_void, url: &str) -> Result<(), ()> {
    if url.len() > 2048
        || url.chars().any(|c| c.is_control())
        || !(url.starts_with("https://") || url.starts_with("http://"))
    {
        return Err(());
    }
    let mut item: *const c_void = std::ptr::null();
    if pam_get_item(pamh, PAM_CONV, &mut item) != PAM_SUCCESS || item.is_null() {
        return Err(());
    }
    let conv = &*item.cast::<PamConv>();
    let callback = conv.conv.ok_or(())?;
    let text = CString::new(format!(
        "Open {url} and sign with your wallet.\nPress Enter after signing: "
    ))
    .map_err(|_| ())?;
    let message = PamMessage {
        msg_style: PAM_PROMPT_ECHO_ON,
        msg: text.as_ptr(),
    };
    let mut message_ptr = &message as *const PamMessage;
    let mut response: *mut PamResponse = std::ptr::null_mut();
    let status = callback(1, &mut message_ptr, &mut response, conv.appdata_ptr);
    // Linux-PAM conversations allocate these with malloc; the module owns them.
    if !response.is_null() {
        libc::free((*response).resp.cast());
        libc::free(response.cast());
    }
    if status == PAM_SUCCESS {
        Ok(())
    } else {
        Err(())
    }
}

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
        if (*argv).is_null() {
            return Err(());
        }
        socket = CStr::from_ptr(*argv)
            .to_str()
            .map_err(|_| ())?
            .strip_prefix("socket=")
            .ok_or(())?;
        if !socket.starts_with('/') {
            return Err(());
        }
    }
    let mut user: *const c_char = std::ptr::null();
    if pam_get_user(pamh, &mut user, std::ptr::null()) != PAM_SUCCESS || user.is_null() {
        return Err(());
    }
    let user = CStr::from_ptr(user).to_str().map_err(|_| ())?;
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
    let now = unix_time();
    if expires_at <= now || expires_at > now + TTL_SECONDS as i64 {
        return Err(());
    }
    if prompt(pamh, &url).is_err() {
        let _ = send(reader.get_mut(), &Request::Cancel { version: VERSION });
        return Err(());
    }
    if unix_time() >= expires_at {
        return Err(());
    }
    send(reader.get_mut(), &Request::Wait { version: VERSION })?;
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
    match catch_unwind(AssertUnwindSafe(|| authenticate(pamh, argc, argv))) {
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
    fn invalid_handle_fails_closed() {
        assert_eq!(
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
