use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::{parse::Nothing, Ident, ItemFn, Result};

pub fn wasm_fn_impl(item: ItemFn, _attr: Nothing) -> Result<TokenStream> {
    let js_name = to_js_name(item.clone().sig.ident);

    let expanded = quote! {
        #[::wasm_bindgen::prelude::wasm_bindgen(js_name = #js_name, skip_jsdoc)]
        #item
    };

    Ok(expanded)
}

fn to_js_name(ident: Ident) -> Ident {
    let mut js_name = String::new();
    let mut capitalize_next = false;

    for (i, c) in ident.to_string().chars().enumerate() {
        if i == 0 {
            js_name.push(c.to_lowercase().next().unwrap());
        } else if c == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            js_name.push(c.to_uppercase().next().unwrap());
            capitalize_next = false;
        } else {
            js_name.push(c);
        }
    }

    format_ident!("{}", js_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_quote;

    #[test]
    fn test_fn() {
        let item = parse_quote! {
            #[existing_attr]
            pub fn foo_foo_bar(a: u64, b: u128) -> u64 {
                42
            }
        };
        let attr = Nothing {};
        let result = wasm_fn_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (js_name = fooFooBar , skip_jsdoc)] # [existing_attr] pub fn foo_foo_bar (a : u64 , b : u128) -> u64 { 42 }");
    }
}
