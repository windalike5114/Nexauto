export const pricingRules = {
  currency: "nzd",
  frontWiperPairBundle: {
    eligibleCategory: "front-wiper-pair",
    twoPairTotalMinor: 10999,
    threePairTotalMinor: 14999,
    twoPairLabel: "2-Pair Bundle Applied",
    threePairLabel: "3-Pair Bundle Applied"
  },
  welcomeReward: {
    amountMinor: 1000,
    label: "Welcome Reward"
  },
  shipping: {
    nzStandardMinor: 800,
    promotionalFreeShippingMinor: 0,
    label: "Promo shipping - normally NZ$8"
  },
  gst: {
    inclusiveRateNumerator: 3,
    inclusiveRateDenominator: 23
  }
} as const;
