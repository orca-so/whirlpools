use serde::Serializer;

// Serialize a u64 as a u128. This is so that we can use u64 value in rust
// but serialize as a bigint in wasm.

pub fn u64_serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_u128(*value as u128)
}
