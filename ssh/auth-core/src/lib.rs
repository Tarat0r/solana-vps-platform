pub mod accounts;
pub mod challenge;
pub mod protocol;

pub const VERSION: u8 = 1;
pub const TTL_SECONDS: u64 = 90;
pub const MAX_FRAME: usize = 16 * 1024;

pub fn unix_time() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn pubkey(text: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = bs58::decode(text).into_vec()?;
    bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("invalid public key length"))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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
