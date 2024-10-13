// While `wasm_expose` doesn't automatically convert rust `u128` to js `bigint`, we have
// to proxy it through an opaque type that we define here. This is a workaround until
// `wasm_bindgen` supports `u128` abi conversion natively.

#[cfg(not(feature = "wasm"))]
pub type U128 = u128;

#[cfg(feature = "wasm")]
use core::fmt::{Debug, Formatter, Result};

#[cfg(feature = "wasm")]
use ethnum::U256;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "bigint")]
    pub type U128;
}

#[cfg(feature = "wasm")]
impl Debug for U128 {
    fn fmt(&self, f: &mut Formatter<'_>) -> Result {
        write!(f, "{:?}", JsValue::from(self))
    }
}

#[cfg(feature = "wasm")]
impl From<U128> for u128 {
    fn from(value: U128) -> u128 {
        JsValue::from(value).try_into().unwrap()
    }
}

#[cfg(feature = "wasm")]
impl From<U128> for U256 {
    fn from(value: U128) -> U256 {
        let u_128: u128 = JsValue::from(value).try_into().unwrap();
        <U256>::from(u_128)
    }
}

#[cfg(feature = "wasm")]
impl From<u128> for U128 {
    fn from(value: u128) -> U128 {
        JsValue::from(value).unchecked_into()
    }
}

#[cfg(feature = "wasm")]
impl PartialEq<u128> for U128 {
    fn eq(&self, other: &u128) -> bool {
        self == &(*other).into()
    }
}
