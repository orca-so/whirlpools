use proc_macro2::TokenStream;
use quote::quote;
use syn::{parse::Nothing, parse_quote, ItemStruct, Result, Type};

pub fn wasm_struct_impl(item: ItemStruct, _attr: Nothing) -> Result<TokenStream> {
    let mut item = item;

    // Add attributes to u64 fields
    for field in &mut item.fields {
        if let Type::Path(type_path) = &field.ty {
            if type_path.path.is_ident("u64") {
                field
                    .attrs
                    .push(parse_quote!(#[serde(serialize_with = "crate::u64_serialize")]));
                field.attrs.push(parse_quote!(#[tsify(type = "bigint")]));
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
    fn test_correct() {
        let item: ItemStruct = parse_quote! {
            #[existing_attr]
            pub struct TestStruct {
                #[existing_attr]
                pub foo: u64,
                pub bar: u128
            }
        };
        let attr = Nothing {};
        let result = wasm_struct_impl(item, attr);
        let output = result.unwrap().to_string();
        assert_eq!(output, "# [derive (:: serde :: Serialize , :: serde :: Deserialize , :: tsify :: Tsify)] # [serde (rename_all = \"camelCase\")] # [tsify (from_wasm_abi , into_wasm_abi)] # [existing_attr] pub struct TestStruct { # [existing_attr] # [serde (serialize_with = \"crate::u64_serialize\")] # [tsify (type = \"bigint\")] pub foo : u64 , pub bar : u128 }");
    }
}
