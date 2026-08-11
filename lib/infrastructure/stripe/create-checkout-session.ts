import Stripe from "stripe";
import type { CheckoutPaymentAdapter, StripeCheckoutSessionAdapterInput, TrustedCheckoutItem } from "@/lib/application/checkout/create-checkout-session";
import { CHECKOUT_CONTRACT_VERSION, PRICING_VERSION } from "@/lib/application/checkout/checkout-contract";

export function createStripeCheckoutSessionAdapter(stripe: Stripe): CheckoutPaymentAdapter {
  return {
    async createCheckoutSession(input) {
      const stripeCustomerId = input.customerEmail ? await createCheckoutCustomer(stripe, input) : undefined;
      const session = await stripe.checkout.sessions.create(buildStripeSessionParams({ ...input, stripeCustomerId }), {
        idempotencyKey: input.orderId
      });

      if (!session.url) throw new Error("Stripe checkout session URL is missing.");

      return {
        sessionId: session.id,
        checkoutUrl: session.url
      };
    }
  };
}

export function buildStripeSessionParams(input: StripeCheckoutSessionAdapterInput): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    locale: "en",
    payment_method_types: ["card", "afterpay_clearpay"],
    adaptive_pricing: {
      enabled: false
    },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        metadata: {
          order_id: input.orderId,
          order_number: input.orderNumber,
          checkout_request_id: input.checkoutRequestId,
          checkout_version: CHECKOUT_CONTRACT_VERSION,
          pricing_version: PRICING_VERSION
        },
        description: `NexAutoParts order ${input.orderNumber}`
      }
    },
    allow_promotion_codes: false,
    customer: input.stripeCustomerId,
    customer_email: input.stripeCustomerId ? undefined : input.customerEmail ?? undefined,
    customer_creation: input.stripeCustomerId ? undefined : "if_required",
    billing_address_collection: "auto",
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: input.pricing.shippingMinor,
            currency: "nzd"
          },
          display_name: input.pricing.shippingMinor === 0 ? "Promo shipping - normally NZ$8" : "Standard NZ shipping",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 1 },
            maximum: { unit: "business_day", value: 4 }
          }
        }
      }
    ],
    line_items: input.items.map((item) => ({
      quantity: item.checkoutQuantity ?? item.cartItem.qty,
      price_data: {
        currency: "nzd",
        unit_amount: Math.round((item.checkoutLineTotal ?? item.price) * 100),
        product_data: {
          name: item.name,
          description: `${item.sku} | ${Object.entries(item.attributes)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ")}`,
          metadata: {
            product_id: item.productId,
            variant_id: item.id,
            sku: item.sku
          }
        }
      }
    })),
    metadata: buildStripeMetadata(input),
    success_url: `${input.siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.siteUrl}/checkout/cancel`
  };
}

async function createCheckoutCustomer(stripe: Stripe, input: StripeCheckoutSessionAdapterInput) {
  const address = toStripeAddress(input.shippingAddress);
  const customer = await stripe.customers.create(
    {
      email: input.customerEmail ?? undefined,
      name: input.shippingAddress.recipientName,
      phone: input.shippingAddress.phone,
      address,
      shipping: {
        name: input.shippingAddress.recipientName,
        phone: input.shippingAddress.phone,
        address
      },
      preferred_locales: ["en"],
      metadata: {
        order_id: input.orderId,
        order_number: input.orderNumber,
        source: "nexauto_checkout"
      }
    },
    {
      idempotencyKey: `customer:${input.orderId}`
    }
  );

  return customer.id;
}

function toStripeAddress(address: StripeCheckoutSessionAdapterInput["shippingAddress"]): Stripe.AddressParam {
  return {
    line1: address.line1,
    line2: address.line2 || undefined,
    city: address.city,
    state: address.region || address.suburb || undefined,
    postal_code: address.postcode,
    country: "NZ"
  };
}

function buildStripeMetadata(input: StripeCheckoutSessionAdapterInput): Stripe.MetadataParam {
  return {
    order_id: input.orderId,
    order_number: input.orderNumber,
    checkout_request_id: input.checkoutRequestId,
    checkout_version: CHECKOUT_CONTRACT_VERSION,
    pricing_version: PRICING_VERSION,
    reward_requested: input.pricing.welcomeRewardMinor > 0 ? "true" : "false",
    source: "nexauto"
  };
}

export function getStripeLineAmountTotal(items: TrustedCheckoutItem[]) {
  return items.reduce((sum, item) => sum + Math.round((item.checkoutLineTotal ?? item.price) * 100) * (item.checkoutQuantity ?? item.cartItem.qty), 0);
}
