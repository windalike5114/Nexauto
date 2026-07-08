import type { WiperSet } from "@/lib/types";

const wiperProductImages = [
  "/yj-wiper/products/beam-wiper-1.jpg",
  "/yj-wiper/products/beam-wiper-2.jpg",
  "/yj-wiper/products/beam-wiper-3.png",
  "/yj-wiper/products/beam-wiper-4.jpg"
];

export function getWiperSetPreviewImage(wiperSet: Pick<WiperSet, "driverLengthIn" | "passengerLengthIn">) {
  const imageIndex = Math.abs(wiperSet.driverLengthIn + wiperSet.passengerLengthIn) % wiperProductImages.length;
  return wiperProductImages[imageIndex];
}
