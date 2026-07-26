import type { FormEvent } from "react";

export type AccountMode = "sign-in" | "sign-up" | "reset-password";
export type AccountSectionId = "dashboard" | "orders" | "rewards" | "vehicles" | "addresses" | "settings";

export type AccountResponse = {
  user: {
    id: string;
    email: string;
  };
  profile: {
    id: string;
    email: string;
    name: string | null;
  };
  vehicles: AccountVehicle[];
  orders: AccountOrder[];
  rewards: {
    welcome: {
      amount: number;
      status: "available" | "used";
    };
  };
};

export type AccountVehicle = {
  id: string;
  applicationId: string | null;
  label: string | null;
  make: string;
  model: string;
  year: number;
  isDefault: boolean;
  lastUsedAt: string;
};

export type AccountOrder = {
  id: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string | null;
  statusDescription: string;
  vehicle: string | null;
  products: string[];
  total: number;
};

export type FitmentResult = {
  applicationId: string;
  frontPair: { sku: string } | null;
  rearAddon: { id: string } | null;
};

export type AuthPanelProps = {
  mode: AccountMode;
  setMode: (mode: AccountMode) => void;
  name: string;
  setName: (name: string) => void;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  confirmPassword: string;
  setConfirmPassword: (password: string) => void;
  loading: boolean;
  message: string;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

export const accountSections: Array<{ id: AccountSectionId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "rewards", label: "Rewards" },
  { id: "vehicles", label: "Saved Vehicles" },
  { id: "addresses", label: "Addresses" },
  { id: "settings", label: "Account Settings" }
];

export function vehicleLabel(vehicle: { make: string; model: string; year: number }) {
  return `${vehicle.make} ${vehicle.model} ${vehicle.year}`.trim();
}

export function sameText(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
