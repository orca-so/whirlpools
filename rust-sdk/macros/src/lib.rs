mod wasm_const;
mod wasm_enum;
mod wasm_fn;
mod wasm_struct;

use proc_macro::TokenStream;
use syn::{parse::Nothing, parse2, Item, Result};

#[proc_macro_attribute]
pub fn wasm_expose(attr: TokenStream, item: TokenStream) -> TokenStream {
    match wasm_expose_impl(attr, item) {
        Ok(expanded) => expanded,
        Err(err) => err.to_compile_error().into(),
    }
}

fn wasm_expose_impl(attr: TokenStream, item: TokenStream) -> Result<TokenStream> {
    let attr: Nothing = parse2(attr.into())?;
    let item: Item = parse2(item.into())?;

    let result = match item {
        Item::Struct(s) => crate::wasm_struct::wasm_struct_impl(s, attr),
        Item::Enum(e) => crate::wasm_enum::wasm_enum_impl(e, attr),
        Item::Const(c) => crate::wasm_const::wasm_const_impl(c, attr),
        Item::Fn(f) => crate::wasm_fn::wasm_fn_impl(f, attr),
        _ => Err(syn::Error::new_spanned(item, "Unexpected item")),
    };

    result.map(|ts| ts.into())
}
