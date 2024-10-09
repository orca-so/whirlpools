use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{parse::Nothing, parse2, Expr, ExprUnary, ItemConst, Lit, Result, UnOp};

// FIXME: also add the rustdoc comment to the generated ts constant

#[proc_macro_attribute]
pub fn export_ts_const(attr: TokenStream, item: TokenStream) -> TokenStream {
    match export_ts_const_impl(attr.into(), item.into()) {
        Ok(expanded) => expanded.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

fn export_ts_const_impl(attr: TokenStream2, item: TokenStream2) -> Result<TokenStream2> {
    let _attr = parse2::<Nothing>(attr)?;

    let item_const: ItemConst = parse2(item)?;

    let const_name = format_ident!("_{}", item_const.ident);
    let const_type = &item_const.ty;
    let attrs = &item_const.attrs;

    let const_value = match &*item_const.expr {
        Expr::Lit(syn::ExprLit { lit, .. }) => match lit {
            Lit::Int(value) => quote! { #value },
            Lit::Float(value) => quote! { #value },
            Lit::Bool(value) => quote! { #value },
            Lit::Str(value) => quote! { #value },
            _ => {
                return Err(syn::Error::new_spanned(
                    &item_const.expr,
                    "Unsupported literal type",
                ))
            }
        },
        Expr::Unary(ExprUnary {
            op: UnOp::Neg(_),
            expr,
            ..
        }) => match &**expr {
            Expr::Lit(syn::ExprLit { lit, .. }) => match lit {
                Lit::Int(value) => quote! { -#value },
                Lit::Float(value) => quote! { -#value },
                _ => {
                    return Err(syn::Error::new_spanned(
                        &item_const.expr,
                        "Unsupported literal type",
                    ))
                }
            },
            _ => {
                return Err(syn::Error::new_spanned(
                    &item_const.expr,
                    "Expected a literal after unary operator",
                ))
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(
                &item_const.expr,
                "Expected a literal or unary operator",
            ))
        }
    };

    let expanded = quote! {
        #(#attrs)*
        #[::wasm_bindgen::prelude::wasm_bindgen(skip_jsdoc)]
        pub fn #const_name() -> #const_type {
            #const_value
        }
        #item_const
    };

    Ok(expanded)
}

#[cfg(test)]
pub mod tests {

    use super::*;

    #[test]
    fn test_correct_input_usize() {
        let tokens = quote! {
            #[export_ts_const]
            pub const TICK_ARRAY_SIZE_TS: usize = 88;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_correct_input_f64() {
        let tokens = quote! {
            #[export_ts_const]
            pub const PI_TS: f64 = 3.14;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_correct_input_negative_int() {
        let tokens = quote! {
            #[export_ts_const]
            pub const NEG_INT_TS: i32 = -42;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_correct_input_negative_float() {
        let tokens = quote! {
            #[export_ts_const]
            pub const NEG_FLOAT_TS: f64 = -3.14;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_correct_input_bool() {
        let tokens = quote! {
            #[export_ts_const]
            pub const IS_ENABLED_TS: bool = true;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_correct_input_string() {
        let tokens = quote! {
            #[export_ts_const]
            pub const NAME_TS: &str = "example";
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_incorrect_input_non_literal() {
        let tokens = quote! {
            #[export_ts_const]
            pub const INVALID_TS: usize = some_function();
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_err());
    }

    #[test]
    fn test_incorrect_input_missing_value() {
        let tokens = quote! {
            #[export_ts_const]
            pub const MISSING_TS: usize;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_err());
    }

    #[test]
    fn test_negative_literals() {
        let tokens = quote! {
            #[export_ts_const]
            pub const NEG_INT: i32 = -123;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());

        let tokens = quote! {
            #[export_ts_const]
            pub const NEG_FLOAT: f64 = -45.67;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());
    }

    #[test]
    fn test_regression_negative_numeric_expansion() {
        // Test case for a negative integer
        let tokens = quote! {
            #[export_ts_const]
            pub const NEG_INT: i32 = -123;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());

        let output = result.unwrap().to_string();
        println!("Generated Output for NEG_INT:\n{}", output);

        assert!(output.contains("pub fn _NEG_INT () -> i32 {"));
        assert!(output.contains("- 123 }"));
        assert!(output.contains("pub const NEG_INT : i32 = - 123 ;"));

        // Test case for a negative float
        let tokens = quote! {
            #[export_ts_const]
            pub const NEG_FLOAT: f64 = -45.67;
        };
        let attr = quote! {};
        let result: Result<TokenStream2> = export_ts_const_impl(attr, tokens);
        assert!(result.is_ok());

        let output = result.unwrap().to_string();
        println!("Generated Output for NEG_FLOAT:\n{}", output);

        assert!(output.contains("pub fn _NEG_FLOAT () -> f64 {"));
        assert!(output.contains("- 45.67 }"));
        assert!(output.contains("pub const NEG_FLOAT : f64 = - 45.67 ;"));
    }
}
