import { useEffect } from 'react';
import { useWalletStore } from '../store';

export function PaymentMethods() {
  const { paymentMethods, fetchPaymentMethods, navigate } = useWalletStore();

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  return (
    <div>
      <button className="text-link" onClick={() => navigate('balance')} style={{ marginBottom: '12px' }}>
        &larr; Back
      </button>
      <h2 className="page-title">Payment Methods</h2>

      {paymentMethods.length === 0 ? (
        <div className="empty-state">
          <p>No payment methods added yet.</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Add a card to start using AI apps with your Byoky balance.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {paymentMethods.map((pm) => (
            <div key={pm.id} className="card">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>
                    {pm.brand === 'visa' ? '💳' : pm.brand === 'mastercard' ? '💳' : '💳'}
                  </span>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 500 }}>
                      {pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)} ****{pm.last4}
                    </div>
                    {pm.isDefault && (
                      <span className="badge" style={{ fontSize: '10px' }}>Default</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '16px', textAlign: 'center' }}>
        Cards are managed securely via Stripe. Byoky never stores your full card details.
      </p>
    </div>
  );
}
