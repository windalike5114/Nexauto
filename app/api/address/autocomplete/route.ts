import { NextResponse } from "next/server";

type GeoapifyResult = {
  place_id?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  housenumber?: string;
  street?: string;
  suburb?: string;
  district?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
};

type AddressSuggestion = {
  placeId: string;
  formatted: string;
  line1: string;
  line2?: string;
  suburb?: string;
  city: string;
  region?: string;
  postcode: string;
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (query.length < 4) {
    return NextResponse.json({ configured: Boolean(process.env.GEOAPIFY_API_KEY), suggestions: [] });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ configured: false, suggestions: [] });
  }

  const params = new URLSearchParams({
    text: query.slice(0, 120),
    filter: "countrycode:nz",
    lang: "en",
    limit: "6",
    format: "json",
    apiKey
  });

  try {
    const response = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`, {
      headers: {
        accept: "application/json"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return NextResponse.json({ configured: true, suggestions: [] }, { status: 200 });
    }

    const data = (await response.json()) as { results?: GeoapifyResult[] };
    const suggestions = (data.results ?? [])
      .filter((result) => String(result.country_code ?? "").toLowerCase() === "nz")
      .map(mapGeoapifyResult)
      .filter(isCompleteSuggestion);

    return NextResponse.json({ configured: true, suggestions });
  } catch {
    return NextResponse.json({ configured: true, suggestions: [] }, { status: 200 });
  }
}

function mapGeoapifyResult(result: GeoapifyResult): AddressSuggestion {
  const line1 = result.address_line1 || [result.housenumber, result.street].filter(Boolean).join(" ");
  const city = result.city || result.town || result.village || result.county || "";
  return {
    placeId: result.place_id ?? result.formatted ?? `${line1}-${result.postcode}`,
    formatted: result.formatted ?? [line1, result.suburb, city, result.postcode].filter(Boolean).join(", "),
    line1,
    line2: result.address_line2,
    suburb: result.suburb || result.district,
    city,
    region: result.state,
    postcode: result.postcode ?? ""
  };
}

function isCompleteSuggestion(suggestion: AddressSuggestion) {
  return Boolean(suggestion.formatted && suggestion.line1 && suggestion.city && suggestion.postcode);
}
