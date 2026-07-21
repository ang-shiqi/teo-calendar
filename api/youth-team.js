const YOUTH_TEAM_CALENDAR_URL = "https://youthteam.bffclimb.com/api/calendar";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const requestedYear = Number(req.query?.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2100
    ? requestedYear
    : new Date().getFullYear();

  try {
    const upstreamUrl = new URL(YOUTH_TEAM_CALENDAR_URL);
    upstreamUrl.searchParams.set("family", "teo");
    upstreamUrl.searchParams.set("year", String(year));

    const response = await fetch(upstreamUrl, {
      headers: { accept: "text/calendar" },
    });

    if (!response.ok) {
      throw new Error(`Youth Team calendar returned ${response.status}`);
    }

    const calendar = await response.text();
    res.setHeader("content-type", "text/calendar; charset=utf-8");
    res.setHeader("cache-control", "s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).send(calendar);
  } catch (error) {
    console.error("Unable to sync Youth Team calendar", error);
    return res.status(502).json({ error: "Unable to sync Youth Team calendar" });
  }
}
