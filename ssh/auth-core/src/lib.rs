pub mod accounts;
pub mod challenge;
pub mod protocol;

pub const VERSION: u8 = 1;
pub const TTL_SECONDS: u64 = 300;
/// [`TTL_SECONDS`] for arithmetic on signed Unix times.
#[expect(clippy::cast_possible_wrap, reason = "300 fits in i64")]
pub const TTL_SECONDS_I64: i64 = TTL_SECONDS as i64;
pub const MAX_FRAME: usize = 16 * 1024;

pub fn unix_time() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_secs()).ok())
        .unwrap_or(0)
}

pub fn pubkey(text: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = bs58::decode(text).into_vec()?;
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("invalid public key length"))
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 15) as usize] as char);
    }
    output
}

pub fn hex32(text: &str) -> anyhow::Result<[u8; 32]> {
    anyhow::ensure!(
        text.len() == 64 && text.bytes().all(|b| b.is_ascii_hexdigit()),
        "invalid hex32"
    );
    let mut result = [0; 32];
    for (i, b) in result.iter_mut().enumerate() {
        *b = u8::from_str_radix(&text[2 * i..2 * i + 2], 16)?;
    }
    Ok(result)
}
