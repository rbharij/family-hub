import { NextResponse } from "next/server"

// WMO weather code → { emoji, description }
const WMO: Record<number, { emoji: string; description: string }> = {
  0:  { emoji: "☀️",  description: "Clear" },
  1:  { emoji: "🌤️", description: "Mainly clear" },
  2:  { emoji: "⛅",  description: "Partly cloudy" },
  3:  { emoji: "☁️",  description: "Overcast" },
  45: { emoji: "🌫️", description: "Foggy" },
  48: { emoji: "🌫️", description: "Icy fog" },
  51: { emoji: "🌦️", description: "Light drizzle" },
  53: { emoji: "🌦️", description: "Drizzle" },
  55: { emoji: "🌧️", description: "Heavy drizzle" },
  61: { emoji: "🌧️", description: "Light rain" },
  63: { emoji: "🌧️", description: "Rain" },
  65: { emoji: "🌧️", description: "Heavy rain" },
  71: { emoji: "❄️",  description: "Light snow" },
  73: { emoji: "❄️",  description: "Snow" },
  75: { emoji: "❄️",  description: "Heavy snow" },
  77: { emoji: "🌨️", description: "Snow grains" },
  80: { emoji: "🌦️", description: "Light showers" },
  81: { emoji: "🌦️", description: "Showers" },
  82: { emoji: "⛈️",  description: "Heavy showers" },
  85: { emoji: "🌨️", description: "Snow showers" },
  86: { emoji: "🌨️", description: "Heavy snow showers" },
  95: { emoji: "⛈️",  description: "Thunderstorm" },
  96: { emoji: "⛈️",  description: "Thunderstorm" },
  99: { emoji: "⛈️",  description: "Severe thunderstorm" },
}

function wmo(code: number) {
  return WMO[code] ?? { emoji: "🌡️", description: "Unknown" }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = searchParams.get("lat") ?? "1.3521"
  const lon = searchParams.get("lon") ?? "103.8198"

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weathercode` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=1`

  const res = await fetch(url, { next: { revalidate: 1800 } })

  if (!res.ok) {
    return NextResponse.json({ error: "Weather fetch failed" }, { status: 502 })
  }

  const raw = await res.json()

  const code      = raw.current?.weathercode ?? 0
  const condition = wmo(code)

  return NextResponse.json(
    {
      temp:        Math.round(raw.current?.temperature_2m ?? 0),
      feelsLike:   Math.round(raw.current?.apparent_temperature ?? 0),
      emoji:       condition.emoji,
      description: condition.description,
      high:        Math.round(raw.daily?.temperature_2m_max?.[0] ?? 0),
      low:         Math.round(raw.daily?.temperature_2m_min?.[0] ?? 0),
      rainChance:  raw.daily?.precipitation_probability_max?.[0] ?? 0,
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
  )
}
