use litesvm::LiteSVM;

#[test]
fn litesvm_boots() {
    let svm = LiteSVM::new();
    let _ = svm.latest_blockhash();
}
