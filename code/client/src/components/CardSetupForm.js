import {
  PaymentElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";
import React, {useState } from "react";
import SignupComplete from "./SignupComplete";

  const CardSetupForm = (props) => {
    const { selected, mode, details, customerId, learnerEmail, learnerName, onSuccessfulConfirmation, clientSecret } =
      props;
    const [paymentSucceeded, setPaymentSucceeded] = useState(false);
    const [error, setError] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [last4, setLast4] = useState("");

    const elements = useElements();
    const stripe = useStripe();

    const handleClick = async (e) => {
      e.preventDefault();
      setProcessing(true);
      setError(null);
      setLast4('')
      setPaymentSucceeded(false);

      if (!stripe || !elements) {
        setError('Stripe.js has not loaded yet. Try again in a few seconds.')
        return;
      }

      const {setupIntent, error} = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: window.location.href,
          expand: ['payment_method'],
          payment_method_data: {
            billing_details: {
                email: learnerEmail,
                name: learnerName,
            },
          },
        },
        redirect: 'if_required',
      });

      if (error) {
        setError(error.message);
        setProcessing(false);
        return;
      }

      if (setupIntent && setupIntent.status === 'succeeded') {
        setLast4(setupIntent.payment_method.card.last4);
        setPaymentSucceeded(true);
      }

      setProcessing(false);
    };

    if (selected === -1) return null;
    if (paymentSucceeded) return (
      <div className={`lesson-form`}>
        <SignupComplete
          active={paymentSucceeded}
          email={learnerEmail}
          last4={last4}
          customer_id={customerId}
        />
      </div>
    )
    return (
      // The actual checkout form, inside the !paymentSucceeded clause
        <div className={`lesson-form`}>
            <div className={`lesson-desc`}>
              <h3>Registration details</h3>
              <div id="summary-table" className="lesson-info">
                {details}
              </div>
              <div className="lesson-legal-info">
                Your card will not be charged. By registering, you hold a session
                slot which we will confirm within 24 hrs.
              </div>
              <div className="lesson-grid">
                <div className="lesson-inputs">
                  <div className="lesson-input-box first">
                    <span>{learnerName} ({learnerEmail})</span>
                  </div>
                  <div className="lesson-payment-element">
                    <form onSubmit={handleClick}>
                      <PaymentElement options={{
                        defaultValues: {
                          billingDetails: {
                            email: learnerEmail,
                            name: learnerName,
                          }
                        }
                      }} />
                      <button id="submit" className="submit" type="submit" disabled={processing}>
                        {processing ? <div className="spinner" id="spinner"></div> :
                            <span id="button-text">Pay</span>}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
              {error && (
                  <div className="sr-field-error" id="card-errors" role="alert">
                  <div className="card-error" role="alert">
                    {error}
                  </div>
                </div>
              )}
            </div>
        </div>
    )
  };
  export default CardSetupForm;
  
