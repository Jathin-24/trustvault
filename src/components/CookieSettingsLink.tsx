"use client";

export default function CookieSettingsLink() {
  return <a href="#cookies" onClick={(event) => { event.preventDefault(); window.dispatchEvent(new Event("trustvault:open-cookie-settings")); }}>Cookie settings</a>;
}
