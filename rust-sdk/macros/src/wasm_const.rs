use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::{parse::Nothing, Expr, ExprUnary, ItemConst, Lit, Result, UnOp};

// FIXME: also add the rustdoc comment to the generated ts constant

pub fn wasm_const_impl(item: ItemConst, _attr: Nothing) -> Result<TokenStream> {
    let const_name = format_ident!("_{}", item.ident);
    let const_type = &item.ty;

    let const_value = match &*item.expr {
        Expr::Lit(syn::ExprLit { lit, .. }) => match lit {
            Lit::Int(value) => Ok(quote! { #value }),
            Lit::Float(value) => Ok(quote! { #value }),
            Lit::Bool(value) => Ok(quote! { #value }),
            Lit::Str(value) => Ok(quote! { #value }),
            _ => {
                return Err(syn::Error::new_spanned(
                    &item.expr,
                    "Unsupported literal type",
                ))
            }
        },
        Expr::Array(array) => {
            let elements: Result<Vec<_>> = array
                .elems
                .iter()
                .map(|elem| match elem {
                    Expr::Lit(syn::ExprLit { lit, .. }) => match lit {
                        Lit::Int(value) => Ok(quote! { #value }),
                        Lit::Float(value) => Ok(quote! { #value }),
                        Lit::Bool(value) => Ok(quote! { #value }),
                        Lit::Str(value) => Ok(quote! { #value }),
                        _ => Err(syn::Error::new_spanned(
                            elem,
                            "Unsupported array element type",
                        )),
                    },
                    _ => Err(syn::Error::new_spanned(
                        elem,
                        "Expected a literal type in array",
                    )),
                })
                .collect();

            elements.map(|elems| quote! { [#(#elems),*] })
        }
        Expr::Unary(ExprUnary {
            op: UnOp::Neg(_),
            expr,
            ..
        }) => match &**expr {
            Expr::Lit(syn::ExprLit { lit, .. }) => match lit {
                Lit::Int(value) => Ok(quote! { -#value }),
                Lit::Float(value) => Ok(quote! { -#value }),
                _ => {
                    return Err(syn::Error::new_spanned(
                        &item.expr,
                        "Unsupported literal type",
                    ))
                }
            },
            _ => {
                return Err(syn::Error::new_spanned(
                    &item.expr,
                    "Expected a literal after unary operator",
                ))
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(
                &item.expr,
                "Expected a literal or array",
            ))
        }
    }?;

    let expanded = quote! {
        #[::wasm_bindgen::prelude::wasm_bindgen(skip_jsdoc)]
        pub fn #const_name() -> #const_type {
            #const_value
        }
        #item
    };

    Ok(expanded)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use syn::parse_quote;

    #[test]
    fn test_usize() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const TICK_ARRAY_SIZE_TS: usize = 88;
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _TICK_ARRAY_SIZE_TS () -> usize { 88 } # [existing_attr] pub const TICK_ARRAY_SIZE_TS : usize = 88 ;");
    }

    #[test]
    fn test_float() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const PI_TS: f64 = 3.14;
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _PI_TS () -> f64 { 3.14 } # [existing_attr] pub const PI_TS : f64 = 3.14 ;");
    }

    #[test]
    fn test_negative_int() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const NEG_INT_TS: i32 = -42;
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _NEG_INT_TS () -> i32 { - 42 } # [existing_attr] pub const NEG_INT_TS : i32 = - 42 ;");
    }

    #[test]
    fn test_negative_float() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const NEG_FLOAT_TS: f64 = -3.14;
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _NEG_FLOAT_TS () -> f64 { - 3.14 } # [existing_attr] pub const NEG_FLOAT_TS : f64 = - 3.14 ;");
    }

    #[test]
    fn test_bool() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const IS_ENABLED_TS: bool = true;
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _IS_ENABLED_TS () -> bool { true } # [existing_attr] pub const IS_ENABLED_TS : bool = true ;");
    }

    #[test]
    fn test_string() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const NAME_TS: &str = "example";
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _NAME_TS () -> & str { \"example\" } # [existing_attr] pub const NAME_TS : & str = \"example\" ;");
    }

    #[test]
    fn test_int_array() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const NUMBERS: [i32; 3] = [1, 2, 3];
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _NUMBERS () -> [i32 ; 3] { [1 , 2 , 3] } # [existing_attr] pub const NUMBERS : [i32 ; 3] = [1 , 2 , 3] ;");
    }

    #[test]
    fn test_bool_array() {
        let item: ItemConst = parse_quote! {
            #[existing_attr]
            pub const BOOLS: [bool; 2] = [true, false];
        };
        let attr = Nothing {};
        let result = wasm_const_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [:: wasm_bindgen :: prelude :: wasm_bindgen (skip_jsdoc)] pub fn _BOOLS () -> [bool ; 2] { [true , false] } # [existing_attr] pub const BOOLS : [bool ; 2] = [true , false] ;");
    }
}
