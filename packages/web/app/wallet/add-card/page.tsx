'use client';

import { useState, useEffect, useCallback } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

const VAULT_URL = process.env.NEXT_PUBLIC_VAULT_URL || 'http://localhost:3100';
const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';

function getTokenFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return params.get('token');
}

function CardForm({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? 'Form validation failed');
      setLoading(false);
      return;
    }

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message ?? 'Failed to confirm card');
      setLoading(false);
      return;
    }

    if (setupIntent?.payment_method) {
      // Attach the payment method to user's vault account
      const pmId = typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;

      const resp = await fetch(`${VAULT_URL}/billing/payment-methods`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ stripePaymentMethodId: pmId }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setError((data as Record<string, Record<string, string>>).error?.message ?? 'Failed to save card');
        setLoading(false);
        return;
      }

      onSuccess();
    }

    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      {error && (
        <div style={{
          marginTop: '12px', padding: '10px 14px', borderRadius: '8px',
          background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px',
        }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || loading}
        style={{
          marginTop: '16px', width: '100%', padding: '12px',
          borderRadius: '10px', border: 'none',
          background: loading ? '#374151' : '#0ea5e9',
          color: '#fff', fontSize: '15px', fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Saving...' : 'Add Card'}
      </button>
    </form>
  );
}

export default function AddCardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const t = getTokenFromHash();
    if (!t) {
      setError('Missing authentication token. Please open this page from the Byoky extension.');
      return;
    }
    setToken(t);

    // Fetch Stripe publishable key from vault if not configured
    if (STRIPE_PK) {
      setStripePromise(loadStripe(STRIPE_PK));
    }

    // Create setup intent
    fetch(`${VAULT_URL}/billing/setup-intent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${t}`,
      },
    })
      .then((resp) => {
        if (!resp.ok) throw new Error('Failed to create setup intent');
        return resp.json();
      })
      .then((data) => {
        setClientSecret((data as { clientSecret: string }).clientSecret);
        // If we didn't have a publishable key, try to get it from the setup intent response
        if (!STRIPE_PK) {
          // Fallback: extract pk from the client secret prefix
          // In production, this should come from an env var or vault endpoint
          setError('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY not configured');
        }
      })
      .catch((err) => setError(err.message));
  }, []);

  const handleSuccess = useCallback(() => {
    setSuccess(true);
    // Notify the extension that card was added
    // Try postMessage to opener, or the extension can poll
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'BYOKY_CARD_ADDED' }, '*');
      }
    } catch {
      // Cross-origin — expected
    }
    // Auto-close after 2 seconds
    setTimeout(() => {
      window.close();
    }, 2000);
  }, []);

  if (success) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#10003;</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Card added</h2>
            <p style={{ color: '#71717a', fontSize: '14px' }}>
              You can close this window. Your wallet is ready to use.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Add Payment Method</h2>
          <div style={{
            padding: '12px 16px', borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px',
          }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!clientSecret || !stripePromise) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#71717a' }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Add Payment Method</h2>
          <p style={{ color: '#71717a', fontSize: '14px' }}>
            Your card is secured by Stripe. Byoky never sees your full card details.
          </p>
        </div>

        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: {
              theme: 'night',
              variables: {
                colorPrimary: '#0ea5e9',
                colorBackground: '#18181b',
                colorText: '#e4e4e7',
                colorDanger: '#ef4444',
                borderRadius: '8px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              },
            },
          }}
        >
          <CardForm token={token!} onSuccess={handleSuccess} />
        </Elements>

        <p style={{ fontSize: '11px', color: '#52525b', textAlign: 'center', marginTop: '16px' }}>
          Your card will be charged when you use AI apps through Byoky.
          You can remove it anytime from your wallet settings.
        </p>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#09090b',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#e4e4e7',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '420px',
  padding: '32px',
  background: '#18181b',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '16px',
};
