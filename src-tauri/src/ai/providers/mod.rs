use std::sync::Arc;

use super::AIProvider;

pub mod apipudding;
pub mod doubao;
pub mod ppio;
pub mod grsai;
pub mod kie;
pub mod fal;
pub mod lemondata;

pub use apipudding::ApipuddingProvider;
pub use doubao::DoubaoProvider;
pub use fal::FalProvider;
pub use grsai::GrsaiProvider;
pub use kie::KieProvider;
pub use ppio::PPIOProvider;
pub use lemondata::LemonDataProvider;

pub fn build_default_providers() -> Vec<Arc<dyn AIProvider>> {
    vec![
        Arc::new(PPIOProvider::new()),
        Arc::new(GrsaiProvider::new()),
        Arc::new(KieProvider::new()),
        Arc::new(FalProvider::new()),
        Arc::new(DoubaoProvider::new()),
        Arc::new(ApipuddingProvider::new()),
        Arc::new(LemonDataProvider::new()),
    ]
}
