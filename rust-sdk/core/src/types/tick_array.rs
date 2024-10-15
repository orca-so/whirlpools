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
impl Into<TickArrays> for TickArrayFacade {
  fn into(self) -> TickArrays {
    TickArrays([Some(self), None, None, None, None, None])
  }
}

#[cfg(not(feature = "wasm"))]
impl Into<TickArrays> for [TickArrayFacade; 1] {
  fn into(self) -> TickArrays {
    TickArrays([Some(self[0]), None, None, None, None, None])
  }
}

#[cfg(not(feature = "wasm"))]
impl Into<TickArrays> for [TickArrayFacade; 2] {
  fn into(self) -> TickArrays {
    TickArrays([Some(self[0]), Some(self[1]), None, None, None, None])
  }
}

#[cfg(not(feature = "wasm"))]
    impl Into<TickArrays> for [TickArrayFacade; 3] {
  fn into(self) -> TickArrays {
    TickArrays([Some(self[0]), Some(self[1]), Some(self[2]), None, None, None])
  }
}

#[cfg(not(feature = "wasm"))]
impl Into<TickArrays> for [TickArrayFacade; 4] {
  fn into(self) -> TickArrays {
    TickArrays([
        Some(self[0]),
        Some(self[1]),
        Some(self[2]),
        Some(self[3]),
        None,
        None,
      ])
    }
}

#[cfg(not(feature = "wasm"))]
impl Into<TickArrays> for [TickArrayFacade; 5] {
    fn into(self) -> TickArrays {
      TickArrays([
        Some(self[0]),
        Some(self[1]),
        Some(self[2]),
        Some(self[3]),
        Some(self[4]),
        None,
      ])
    }
}

#[cfg(not(feature = "wasm"))]
impl Into<TickArrays> for [TickArrayFacade; 6] {
    fn into(self) -> TickArrays {
      TickArrays([
        Some(self[0]),
        Some(self[1]),
        Some(self[2]),
        Some(self[3]),
        Some(self[4]),
        Some(self[5]),
      ])
    }
}
