#[derive(Debug, Default)]
pub enum ComputeUnitLimitStrategy {
    #[default]
    Dynamic,
    Exact(u32),
}

#[derive(Debug, Default)]
pub struct ComputeConfig {
    pub unit_limit: ComputeUnitLimitStrategy,
}
