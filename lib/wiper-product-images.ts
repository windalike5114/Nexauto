import { blobMediaAssets } from "@/lib/blob-media-assets";
import type { WiperSet } from "@/lib/types";

const mainWiperProductImage = blobMediaAssets.images.find((asset) => asset.name === "nexautowiper1")?.url ?? "";

export function getWiperSetPreviewImage(_wiperSet: Pick<WiperSet, "driverLengthIn" | "passengerLengthIn">) {
  return mainWiperProductImage;
}
