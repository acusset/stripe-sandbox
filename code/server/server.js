/* eslint-disable no-console */
const express = require('express');

const app = express();
const {resolve} = require('path');
// Replace if using a different env file or config
require('dotenv').config({path: './.env'});
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const {v4: uuidv4} = require('uuid');

const allitems = {};
const fs = require('fs');

app.use(express.static(process.env.STATIC_DIR));

app.use(
  express.json(
    {
      // Should use middleware or a function to compute it only when
      // hitting the Stripe webhook endpoint.
      verify: (req, res, buf) => {
        if (req.originalUrl.startsWith('/webhook')) {
          req.rawBody = buf.toString();
        }
      },
    },
  ),
);
app.use(cors({origin: true}));

// const asyncMiddleware = fn => (req, res, next) => {
//   Promise.resolve(fn(req, res, next)).catch(next);
// };

app.post("/webhook", async (req, res) => {
  // TODO: Integrate Stripe
});

// Routes
app.get('/', (req, res) => {
  try {
    const path = resolve(`${process.env.STATIC_DIR}/index.html`);
    if (!fs.existsSync(path)) throw Error();
    res.sendFile(path);
  } catch (error) {
    const path = resolve('./public/static-file-error.html');
    res.sendFile(path);
  }
});

// Fetch the Stripe publishable key
//
// Example call:
// curl -X GET http://localhost:4242/config \
//
// Returns: a JSON response of the pubblishable key
//   {
//        key: <STRIPE_PUBLISHABLE_KEY>
//   }
app.get("/config", (req, res) => {
  res.status(200).send({key: process.env.STRIPE_PUBLISHABLE_KEY});
});

// Milestone 1: Signing up
// Shows the lesson sign up page.
app.get('/lessons', (req, res) => {
  try {
    const path = resolve(`${process.env.STATIC_DIR}/lessons.html`);
    if (!fs.existsSync(path)) throw Error();
    res.sendFile(path);
  } catch (error) {
    const path = resolve('./public/static-file-error.html');
    res.sendFile(path);
  }
});

// Milestone 1: Signing up
// Handles the lesson sign up form submission.
app.post("/lessons", async (req, res) => {
  const {email, name, firstLesson} = req.body;
  let customer = null
  let isExistingCustomer = false;
  let search = await stripe.customers.list({
    email: email
  });

  if (search.data.length > 0) {
    customer = search.data[0];
    isExistingCustomer = true
  } else {
    customer = await stripe.customers.create({
      name: name,
      email: email,
      metadata: {
        "first_lesson": firstLesson,
      }
    })
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customer.id,
  });

  return res.status(201).send({
    clientSecret: setupIntent.client_secret,
    isExistingCustomer: isExistingCustomer,
    customer: customer,
  });
});

// Milestone 2: '/schedule-lesson'
// Authorize a payment for a lesson
//
// Parameters:
// customer_id: id of the customer
// amount: amount of the lesson in cents
// description: a description of this lesson
//
// Example call:
// curl -X POST http://localhost:4242/schedule-lesson \
//  -d customer_id=cus_GlY8vzEaWTFmps \
//  -d amount=4500 \
//  -d description='Lesson on Feb 25th'
//
// Returns: a JSON response of one of the following forms:
// For a successful payment, return the Payment Intent:
//   {
//        payment: <payment_intent>
//    }
//
// For errors:
//  {
//    error:
//       code: the code returned from the Stripe error if there was one
//       message: the message returned from the Stripe error. if no payment method was
//         found for that customer return an msg 'no payment methods found for <customer_id>'
//    payment_intent_id: if a payment intent was created but not successfully authorized
// }
app.post("/schedule-lesson", async (req, res) => {
  const {customer_id, amount, description} = req.body;

  try {
    const customerPaymentMethods = await stripe.customers.listPaymentMethods(customer_id);

    const paymentIntent = await stripe.paymentIntents.create({
      customer: customer_id,
      amount: amount,
      description: description,
      currency: 'usd',
      confirm: true,
      capture_method: "manual",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        type: "lessons-payment",
      },
      payment_method: customerPaymentMethods.data.pop().id,
    });

    return res.status(201).send({payment: paymentIntent});
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});

// Milestone 2: '/complete-lesson-payment'
// Capture a payment for a lesson.
//
// Parameters:
// amount: (optional) amount to capture if different than the original amount authorized
//
// Example call:
// curl -X POST http://localhost:4242/complete_lesson_payment \
//  -d payment_intent_id=pi_XXX \
//  -d amount=4500
//
// Returns: a JSON response of one of the following forms:
//
// For a successful payment, return the payment intent:
//   {
//        payment: <payment_intent>
//    }
//
// for errors:
//  {
//    error:
//       code: the code returned from the error
//       message: the message returned from the error from Stripe
// }
//
app.post("/complete-lesson-payment", async (req, res) => {
  const {payment_intent_id, amount} = req.body;
  let options = undefined;

  try {
    if (amount) {
      options = {amount_to_capture: amount}
    }

    let paymentIntent = await stripe.paymentIntents.capture(payment_intent_id, options);

    return res.status(200).send({payment: paymentIntent});
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});

// Milestone 2: '/refund-lesson'
// Refunds a lesson payment.  Refund the payment from the customer (or cancel the auth
// if a payment hasn't occurred).
// Sets the refund reason to 'requested_by_customer'
//
// Parameters:
// payment_intent_id: the payment intent to refund
// amount: (optional) amount to refund if different than the original payment
//
// Example call:
// curl -X POST http://localhost:4242/refund-lesson \
//   -d payment_intent_id=pi_XXX \
//   -d amount=2500
//
// Returns
// If the refund is successfully created returns a JSON response of the format:
//
// {
//   refund: refund.id
// }
//
// If there was an error:
//  {
//    error: {
//        code: e.error.code,
//        message: e.error.message
//      }
//  }
app.post("/refund-lesson", async (req, res) => {
  const {payment_intent_id, amount} = req.body;

  try {
    let refund = await stripe.refunds.create({
      payment_intent: payment_intent_id,
      amount: amount,
    });

    return res.status(201).send({refund: refund.id});
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});

// Milestone 3: Managing account info
// Displays the account update page for a given customer
app.get("/account-update/:customer_id", async (req, res) => {
  try {
    const path = resolve(`${process.env.STATIC_DIR}/account-update.html`);
    if (!fs.existsSync(path)) throw Error();
    res.sendFile(path);
  } catch (error) {
    const path = resolve('./public/static-file-error.html');
    res.sendFile(path);
  }
});

app.get("/payment-method/:customer_id", async (req, res) => {
  const {customer_id} = req.params;

  try {
    const customers = await stripe.paymentMethods.list({
      customer: customer_id,
      expand: ['data.customer'],
    });

    return res.status(200).send(customers.data.pop());
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});

// TODO: Update the customer's payment details
app.post("/update-payment-details/:customer_id", async (req, res) => {
  const {customer_id} = req.params;
  const {payment_method} = req.body
  const promises = [];

  try {
    const customerPaymentMethods = await stripe.customers.listPaymentMethods(customer_id);

    // Detach old payment methods
    customerPaymentMethods.data.forEach((paymentMethod, index) => {
      if (paymentMethod.id !== payment_method) {
        promises[index] = stripe.paymentMethods.detach(paymentMethod.id);
      }
    });

    await Promise.all(promises);

    res.sendStatus(200);
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});

// Handle account update
// TODO: Handle updates to any of the customer's account details
app.post("/account-update/:customer_id", async (req, res) => {
  const {email, name} = req.body;
  const {customer_id} = req.params;
  let customer = null;

  try {
    let existingCustomers = await stripe.customers.list({
      email: email,
    });

    if (existingCustomers.data.length > 0 && existingCustomers.data[0].id !== customer_id) {
      throw new Error('Customer email already exists!'); // caught below
    }

    // Update customer details
    customer = existingCustomers.data[0];
    if (customer.email !== email || customer.name !== name) {
      customer = await stripe.customers.update(customer_id, {
        email: email,
        name: name
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
    });

    return res.status(200).send({
      clientSecret: setupIntent.client_secret
    });
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code ?? 400,
        message: error.message
      }
    });
  }
});

// Milestone 3: '/delete-account'
// Deletes a customer object if there are no uncaptured payment intents for them.
//
// Parameters:
//   customer_id: the id of the customer to delete
//
// Example request
//   curl -X POST http://localhost:4242/delete-account/:customer_id \
//
// Returns 1 of 3 responses:
// If the customer had no uncaptured charges and was successfully deleted returns the response:
//   {
//        deleted: true
//   }
//
// If the customer had uncaptured payment intents, return a list of the payment intent ids:
//   {
//     uncaptured_payments: ids of any uncaptured payment intents
//   }
//
// If there was an error:
//  {
//    error: {
//        code: e.error.code,
//        message: e.error.message
//      }
//  }
//
app.post("/delete-account/:customer_id", async (req, res) => {
  const {customer_id} = req.params;

  try {
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customer_id
    });

    if (paymentIntents.data.length > 0) {
      const notCapturedPaymentIntents = paymentIntents.data.filter(pi => pi.status === 'requires_capture');

      if (notCapturedPaymentIntents.length > 0) {
        return res.json({
          uncaptured_payments: notCapturedPaymentIntents.map((pi) => pi.id),
        });
      }
    }

    await stripe.customers.del(customer_id);

    return res.status(200).send({deleted: true});
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});


// Milestone 4: '/calculate-lesson-total'
// Returns the total amounts for payments for lessons, ignoring payments
// for videos and concert tickets, ranging over the last 36 hours.
//
// Example call: curl -X GET http://localhost:4242/calculate-lesson-total
//
// Returns a JSON response of the format:
// {
//      payment_total: Total before fees and refunds (including disputes), and excluding payments
//         that haven't yet been captured.
//      fee_total: Total amount in fees that the store has paid to Stripe
//      net_total: Total amount the store has collected from payments, minus their fees.
// }
//
app.get("/calculate-lesson-total", async (req, res) => {
  const thirtySixHoursAgo = Math.floor(Date.now() / 1000 - 36 * 60 * 60);
  let result = {
    payment_total: 10,
    fee_total: 10,
    net_total: 10,
  }; // to prevent the test from failing at first if we return 0

  try {
    const charges = await stripe.charges.list({
      created: {
        gte: thirtySixHoursAgo,
      },
      limit: 500,
      expand: ['data.balance_transaction'],
      currency: 'usd'
    });

    result = charges.data
      .filter(charge => {
        return charge.status === 'succeeded' && charge.metadata.type === 'lessons-payment' && charge.balance_transaction;
      }).reduce((accumulator, charge, currentIndex) => {
        const {amount, fee, net} = charge.balance_transaction;

        return {
          payment_total: accumulator.payment_total + amount,
          fee_total: accumulator.fee_total + fee,
          net_total: accumulator.net_total + net,
        }
      }, {
        payment_total: 0,
        fee_total: 0,
        net_total: 0,
      });

    return res.status(200).send(result);
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});


// Milestone 4: '/find-customers-with-failed-payments'
// Returns any customer who meets the following conditions:
// The last attempt to make a payment for that customer failed.
// The payment method associated with that customer is the same payment method used
// for the failed payment, in other words, the customer has not yet supplied a new payment method.
//
// Example request: curl -X GET http://localhost:4242/find-customers-with-failed-payments
//
// Returns a JSON response with information about each customer identified and
// their associated last payment
// attempt and, info about the payment method on file.
// [
//   {
//     customer: {
//       id: customer.id,
//       email: customer.email,
//       name: customer.name,
//     },
//     payment_intent: {
//       created: created timestamp for the payment intent
//       description: description from the payment intent
//       status: the status of the payment intent
//       error: the reason that the payment attempt was declined
//     },
//     payment_method: {
//       last4: last four of the card stored on the customer
//       brand: brand of the card stored on the customer
//     }
//   },
//   {},
//   {},
// ]
app.get("/find-customers-with-failed-payments", async (req, res) => {
  const thirtySixHoursAgo = Math.floor(Date.now() / 1000 - 36 * 60 * 60);

  try {
    const failedPayments = await stripe.paymentIntents.list({
      created: {
        gte: thirtySixHoursAgo
      },
      limit: 500,
      expand: ['data.last_payment_error', 'data.customer']
    })

    const customersWithFailedPayments = failedPayments.data
      .filter(failedPayments => {
        return failedPayments.status === 'requires_payment_method' && failedPayments.customer && failedPayments.last_payment_error;
      })
      .map((paymentIntent) => {
        const {
          customer, description, created, status, last_payment_error: {
            decline_code, payment_method: {
              card: {
                last4, brand
              }
            }
          }
        } = paymentIntent;

      return {
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
        },
        payment_intent: {
          created: created,
          description: description,
          status: 'failed',
          error: decline_code,
        },
        payment_method: {
          last4: last4,
          brand: brand
        }
      }
    });

    return res.status(200).send(customersWithFailedPayments)
  } catch (error) {
    return res.status(400).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }
});

function errorHandler(err, req, res, next) {
  res.status(500).send({error: {message: err.message}});
}

app.use(errorHandler);

app.listen(4242, () => console.log(`Node server listening on port http://localhost:${4242}`));
