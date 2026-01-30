use solana_security_txt::security_txt;

#[cfg(feature = "whirlpool-entrypoint")]
security_txt! {
    name: "Orca Whirlpool program",
    project_url: "https://orca.so",
    contacts: "discord:https://discord.orca.so/,twitter:https://twitter.com/orca_so",
    policy: "https://immunefi.com/bounty/orca/",
    source_code: "https://github.com/orca-so/whirlpools"
}
