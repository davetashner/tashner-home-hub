import { describe, expect, it } from 'vitest';
import {
	WEATHER_STALE_MS,
	WEATHER_TTL_MS,
	dayLabel,
	describeWeather,
	forecastUrl,
	isOutOfDate,
	needsRefresh,
	parseForecast,
	parseGeocoding,
	parseLocation,
	unitSymbol
} from './weather.js';

const loc = { lat: 10, lon: 20, name: 'Testville', unit: 'F' as const };
const good = {
	current: {
		temperature_2m: 71.6,
		apparent_temperature: 70.2,
		weather_code: 2,
		is_day: 1,
		wind_speed_10m: 6.4
	},
	daily: {
		time: ['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11', '2030-01-12'],
		weather_code: [0, 3, 61, 95, 71, 1],
		temperature_2m_max: [75.4, 70, 60, 58, 30, 40],
		temperature_2m_min: [50.5, 49, 44, 40, 20, 22],
		precipitation_probability_max: [0, 10, 80, 90, 40, 5]
	}
};

describe('describeWeather', () => {
	it('maps known codes', () => {
		expect(describeWeather(0).label).toBe('Clear');
		expect(describeWeather(95).icon).toBe('⛈️');
	});
	it('uses a moon for clear nights and clouds for mostly-clear nights', () => {
		expect(describeWeather(0, false).icon).toBe('🌙');
		expect(describeWeather(1, false).icon).toBe('☁️');
		expect(describeWeather(3, false).label).toBe('Overcast');
	});
	it('degrades on unknown codes', () => {
		expect(describeWeather(1234).label).toBe('Unknown');
	});
});

describe('parseLocation', () => {
	it('accepts numbers and numeric strings, rounds, defaults to F', () => {
		expect(parseLocation({ lat: '10.12345', lon: 20, name: ' X ' })).toEqual({
			lat: 10.123,
			lon: 20,
			name: 'X',
			unit: 'F'
		});
		expect(parseLocation({ lat: 1, lon: 2, unit: 'C' })?.unit).toBe('C');
	});
	it('rejects bad input', () => {
		expect(parseLocation(null)).toBeNull();
		expect(parseLocation({ lat: 91, lon: 0 })).toBeNull();
		expect(parseLocation({ lat: 0, lon: 181 })).toBeNull();
		expect(parseLocation({ lat: '', lon: 0 })).toBeNull();
		expect(parseLocation({ lat: 'abc', lon: 0 })).toBeNull();
		expect(parseLocation({ lat: 0 })).toBeNull();
	});
});

describe('forecastUrl', () => {
	it('is keyless and unit aware', () => {
		const f = forecastUrl(loc);
		expect(f).toContain('api.open-meteo.com');
		expect(f).toContain('temperature_unit=fahrenheit');
		expect(f).toContain('wind_speed_unit=mph');
		const c = forecastUrl({ ...loc, unit: 'C' });
		expect(c).toContain('temperature_unit=celsius');
		expect(c).toContain('kmh');
	});
});

describe('parseForecast', () => {
	it('parses current and five days', () => {
		const s = parseForecast(good, 'F', 5);
		expect(s?.current).toEqual({ temp: 72, feelsLike: 70, wind: 6, code: 2, isDay: true });
		expect(s?.days).toHaveLength(5);
		expect(s?.days[0]).toEqual({ date: '2030-01-07', code: 0, high: 75, low: 51, precip: 0 });
		expect(s?.fetchedAt).toBe(5);
	});
	it('tolerates missing optional fields', () => {
		const s = parseForecast(
			{
				current: { temperature_2m: 3, weather_code: 0, is_day: 0 },
				daily: { ...good.daily, precipitation_probability_max: undefined }
			},
			'C',
			1
		);
		expect(s?.current.feelsLike).toBe(3);
		expect(s?.current.wind).toBe(0);
		expect(s?.current.isDay).toBe(false);
		expect(s?.days[0].precip).toBeNull();
	});
	it('skips bad days and rejects malformed responses', () => {
		const bad = { ...good, daily: { ...good.daily, time: [7, ...good.daily.time.slice(1)] } };
		expect(parseForecast(bad, 'F', 1)?.days).toHaveLength(5);
		expect(parseForecast(null, 'F', 1)).toBeNull();
		expect(parseForecast({}, 'F', 1)).toBeNull();
		expect(parseForecast({ current: {}, daily: good.daily }, 'F', 1)).toBeNull();
		expect(parseForecast({ current: good.current, daily: { time: 'x' } }, 'F', 1)).toBeNull();
		expect(
			parseForecast(
				{ current: good.current, daily: { ...good.daily, temperature_2m_min: 1 } },
				'F',
				1
			)
		).toBeNull();
		expect(
			parseForecast({ current: good.current, daily: { ...good.daily, time: [] } }, 'F', 1)
		).toBeNull();
	});
});

describe('parseGeocoding', () => {
	it('builds labels and skips junk', () => {
		const r = parseGeocoding({
			results: [
				{
					name: 'Testville',
					admin1: 'Exampleshire',
					country: 'Nowhere',
					latitude: 1,
					longitude: 2
				},
				{ name: 'Bare', latitude: 3, longitude: 4 },
				{ name: 'NoCoords' },
				null
			]
		});
		expect(r).toEqual([
			{ lat: 1, lon: 2, name: 'Testville, Exampleshire, Nowhere' },
			{ lat: 3, lon: 4, name: 'Bare' }
		]);
		expect(parseGeocoding({})).toEqual([]);
		expect(parseGeocoding(null)).toEqual([]);
	});
});

describe('cache freshness', () => {
	const snap = { fetchedAt: 1_000_000, unit: 'F' as const };
	it('refreshes when missing, expired, unit changed or clock went backwards', () => {
		expect(needsRefresh(null, loc, 0)).toBe(true);
		expect(needsRefresh(snap, loc, snap.fetchedAt + WEATHER_TTL_MS - 1)).toBe(false);
		expect(needsRefresh(snap, loc, snap.fetchedAt + WEATHER_TTL_MS)).toBe(true);
		expect(needsRefresh(snap, { ...loc, unit: 'C' }, snap.fetchedAt)).toBe(true);
		expect(needsRefresh(snap, loc, snap.fetchedAt - 1)).toBe(true);
	});
	it('flags out-of-date data', () => {
		expect(isOutOfDate(snap, snap.fetchedAt + WEATHER_STALE_MS - 1)).toBe(false);
		expect(isOutOfDate(snap, snap.fetchedAt + WEATHER_STALE_MS)).toBe(true);
	});
});

describe('labels', () => {
	it('labels days', () => {
		expect(dayLabel('2030-01-07', 0)).toBe('Today');
		expect(dayLabel('2030-01-08', 1)).toBe('Tue');
		expect(dayLabel('garbage', 1)).toBe('garbage');
		expect(unitSymbol('C')).toBe('°C');
		expect(unitSymbol('F')).toBe('°F');
	});
});
