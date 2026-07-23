"use client";

import { useEffect } from "react";

export function CheckoutCancelActions() {
  useEffect(() => {
    window.sessionStorage.removeItem("nexauto-checkout-request-id");
  }, []);

  return null;
}
