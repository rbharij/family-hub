"use client"

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react"
import { createClient } from "@/lib/supabase"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AppSettings {
  id: string
  familyName: string
  setupComplete: boolean
  darkFromHour: number
  lightFromHour: number
  weatherLocation: string
  weatherLat: number
  weatherLon: number
}

interface AppSettingsContextValue {
  settings: AppSettings | null
  loading: boolean
  updateSettings: (patch: Partial<Omit<AppSettings, "id">>) => Promise<void>
  refetch: () => Promise<void>
}

// ── Context ───────────────────────────────────────────────────────────────────

const AppSettingsContext = createContext<AppSettingsContextValue>({
  settings: null,
  loading: true,
  updateSettings: async () => {},
  refetch: async () => {},
})

export function useAppSettings() {
  return useContext(AppSettingsContext)
}

// ── Provider ──────────────────────────────────────────────────────────────────

type SettingsRow = {
  id: string
  family_name: string
  setup_complete: boolean
  dark_from_hour: number
  light_from_hour: number
  weather_location: string | null
  weather_lat: number | null
  weather_lon: number | null
}

function toModel(row: SettingsRow): AppSettings {
  return {
    id: row.id,
    familyName: row.family_name,
    setupComplete: row.setup_complete,
    darkFromHour: row.dark_from_hour,
    lightFromHour: row.light_from_hour,
    weatherLocation: row.weather_location ?? "Singapore",
    weatherLat: row.weather_lat ?? 1.3521,
    weatherLon: row.weather_lon ?? 103.8198,
  }
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = useRef(createClient()).current

  const fetchSettings = useCallback(async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("id, family_name, setup_complete, dark_from_hour, light_from_hour, weather_location, weather_lat, weather_lon")
      .single()

    if (data) {
      const s = toModel(data as SettingsRow)
      setSettings(s)
      localStorage.setItem("dark-from-hour", String(s.darkFromHour))
      localStorage.setItem("light-from-hour", String(s.lightFromHour))
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const updateSettings = useCallback(
    async (patch: Partial<Omit<AppSettings, "id">>) => {
      if (!settings) return

      const dbPatch: Record<string, unknown> = {}
      if (patch.familyName       !== undefined) dbPatch.family_name      = patch.familyName
      if (patch.setupComplete    !== undefined) dbPatch.setup_complete   = patch.setupComplete
      if (patch.darkFromHour     !== undefined) dbPatch.dark_from_hour   = patch.darkFromHour
      if (patch.lightFromHour    !== undefined) dbPatch.light_from_hour  = patch.lightFromHour
      if (patch.weatherLocation  !== undefined) dbPatch.weather_location = patch.weatherLocation
      if (patch.weatherLat       !== undefined) dbPatch.weather_lat      = patch.weatherLat
      if (patch.weatherLon       !== undefined) dbPatch.weather_lon      = patch.weatherLon

      await supabase.from("app_settings").update(dbPatch).eq("id", settings.id)

      const updated = { ...settings, ...patch }
      setSettings(updated)
      localStorage.setItem("dark-from-hour", String(updated.darkFromHour))
      localStorage.setItem("light-from-hour", String(updated.lightFromHour))
    },
    [settings, supabase],
  )

  return (
    <AppSettingsContext.Provider
      value={{ settings, loading, updateSettings, refetch: fetchSettings }}
    >
      {children}
    </AppSettingsContext.Provider>
  )
}
