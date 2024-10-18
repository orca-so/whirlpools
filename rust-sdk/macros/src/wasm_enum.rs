use proc_macro2::TokenStream;
use quote::quote;
use syn::{parse::Nothing, parse_quote, Fields, ItemEnum, Result, Type};

pub fn wasm_enum_impl(item: ItemEnum, _attr: Nothing) -> Result<TokenStream> {
    let mut item = item;

    // Add attributes to u64 fields
    for variant in &mut item.variants {
        if let Fields::Named(fields) = &mut variant.fields {
            for field in &mut fields.named {
                if let Type::Path(type_path) = &field.ty {
                    if type_path.path.is_ident("u64") {
                        field
                            .attrs
                            .push(parse_quote!(#[serde(serialize_with = "crate::u64_serialize")]));
                        field.attrs.push(parse_quote!(#[tsify(type = "bigint")]));
                    }
                }
            }
        }
    }

    let expanded = quote! {
        #[derive(::serde::Serialize, ::serde::Deserialize, ::tsify::Tsify)]
        #[serde(rename_all = "camelCase")]
        #[tsify(from_wasm_abi, into_wasm_abi)]
        #item
    };

    Ok(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use syn::parse_quote;

    #[test]
    fn test_enum() {
        let item: ItemEnum = parse_quote! {
            #[existing_attr]
            pub enum TestEnum {
                A(u64, u128),
                B { a: u64, #[existing_attr] b: u128 },
                C
            }
        };
        let attr = Nothing {};
        let result = wasm_enum_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [derive (:: serde :: Serialize , :: serde :: Deserialize , :: tsify :: Tsify)] # [serde (rename_all = \"camelCase\")] # [tsify (from_wasm_abi , into_wasm_abi)] # [existing_attr] pub enum TestEnum { A (u64 , u128) , B { # [serde (serialize_with = \"crate::u64_serialize\")] # [tsify (type = \"bigint\")] a : u64 , # [existing_attr] b : u128 } , C }");
    }
}
