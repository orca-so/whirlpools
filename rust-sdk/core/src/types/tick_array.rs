use crate::types::TickArrayFacade;

#[cfg(not(feature = "wasm"))]
pub struct TickArrays([Option<TickArrayFacade>; 6]);

#[cfg(feature = "wasm")]
use core::fmt::{Debug, Formatter, Result as FmtResult};

#[cfg(feature = "wasm")]
use js_sys::Array;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "TickArrayFacade[]")]
    pub type TickArrays;
}

#[cfg(feature = "wasm")]
impl Debug for TickArrays {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "{:?}", JsValue::from(self))
    }
}

#[cfg(feature = "wasm")]
impl From<TickArrays> for [Option<TickArrayFacade>; 6] {
    fn from(val: TickArrays) -> Self {
        let val = JsValue::from(val);
        if !val.is_array() {
            return [None, None, None, None, None, None];
        }
        let array: Array = val.unchecked_into();
        let mut result = [None, None, None, None, None, None];
        for (i, item) in array.iter().enumerate() {
            if let Ok(item) = serde_wasm_bindgen::from_value(item) {
                result[i] = Some(item);
            }
        }
        result
    }
}

#[cfg(not(feature = "wasm"))]
impl From<TickArrays> for [Option<TickArrayFacade>; 6] {
    fn from(val: TickArrays) -> Self {
        val.0
    }
}

#[cfg(not(feature = "wasm"))]
impl From<TickArrayFacade> for TickArrays {
    fn from(val: TickArrayFacade) -> Self {
        TickArrays([Some(val), None, None, None, None, None])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 1]> for TickArrays {
    fn from(val: [TickArrayFacade; 1]) -> Self {
        TickArrays([Some(val[0]), None, None, None, None, None])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 2]> for TickArrays {
    fn from(val: [TickArrayFacade; 2]) -> Self {
        TickArrays([Some(val[0]), Some(val[1]), None, None, None, None])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 3]> for TickArrays {
    fn from(val: [TickArrayFacade; 3]) -> Self {
        TickArrays([Some(val[0]), Some(val[1]), Some(val[2]), None, None, None])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 4]> for TickArrays {
    fn from(val: [TickArrayFacade; 4]) -> Self {
        TickArrays([
            Some(val[0]),
            Some(val[1]),
            Some(val[2]),
            Some(val[3]),
            None,
            None,
        ])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 5]> for TickArrays {
    fn from(val: [TickArrayFacade; 5]) -> Self {
        TickArrays([
            Some(val[0]),
            Some(val[1]),
            Some(val[2]),
            Some(val[3]),
            Some(val[4]),
            None,
        ])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 6]> for TickArrays {
    fn from(val: [TickArrayFacade; 6]) -> Self {
        TickArrays([
            Some(val[0]),
            Some(val[1]),
            Some(val[2]),
            Some(val[3]),
            Some(val[4]),
            Some(val[5]),
        ])
    }
}
