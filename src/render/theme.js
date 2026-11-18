export const PALETTES = {
	midnight: {
		bg: 'linear-gradient(165deg,#070B16 0%,#101B33 52%,#060A14 100%)',
		ink: '#F8FAFC',
		muted: 'rgba(226,232,240,.66)',
		accent: '#5EEAD4',
		accent2: '#818CF8',
		card: 'rgba(255,255,255,.06)',
		border: 'rgba(255,255,255,.14)',
		shadow: 'rgba(0,0,0,.45)',
	},
	ocean: {
		bg: 'linear-gradient(180deg,#031A2C 0%,#064663 55%,#021018 100%)',
		ink: '#F0F9FF',
		muted: 'rgba(186,230,253,.7)',
		accent: '#38BDF8',
		accent2: '#22D3EE',
		card: 'rgba(14,116,144,.22)',
		border: 'rgba(56,189,248,.32)',
		shadow: 'rgba(0,0,0,.5)',
	},
	sunset: {
		bg: 'linear-gradient(165deg,#2A0A2E 0%,#7C2D12 48%,#160409 100%)',
		ink: '#FFF7ED',
		muted: 'rgba(254,215,170,.72)',
		accent: '#FDBA74',
		accent2: '#F472B6',
		card: 'rgba(255,255,255,.07)',
		border: 'rgba(253,186,116,.28)',
		shadow: 'rgba(0,0,0,.45)',
	},
	neon: {
		bg: 'radial-gradient(120% 80% at 50% 0%,#1B0B2E 0%,#08040F 60%,#05030A 100%)',
		ink: '#FAF5FF',
		muted: 'rgba(233,213,255,.68)',
		accent: '#C084FC',
		accent2: '#22D3EE',
		card: 'rgba(192,132,252,.1)',
		border: 'rgba(192,132,252,.3)',
		shadow: 'rgba(0,0,0,.55)',
	},
	forest: {
		bg: 'linear-gradient(165deg,#04120C 0%,#0B2E1F 55%,#030B07 100%)',
		ink: '#ECFDF5',
		muted: 'rgba(167,243,208,.66)',
		accent: '#34D399',
		accent2: '#A3E635',
		card: 'rgba(255,255,255,.05)',
		border: 'rgba(52,211,153,.26)',
		shadow: 'rgba(0,0,0,.5)',
	},
	candy: {
		bg: 'linear-gradient(165deg,#FDF2F8 0%,#EDE9FE 55%,#FEF3C7 100%)',
		ink: '#1E1B4B',
		muted: 'rgba(30,27,75,.62)',
		accent: '#DB2777',
		accent2: '#7C3AED',
		card: 'rgba(255,255,255,.72)',
		border: 'rgba(30,27,75,.14)',
		shadow: 'rgba(30,27,75,.22)',
	},
	mono: {
		bg: 'linear-gradient(180deg,#0A0A0A 0%,#161616 55%,#060606 100%)',
		ink: '#FFFFFF',
		muted: 'rgba(255,255,255,.6)',
		accent: '#D9F99D',
		accent2: '#FFFFFF',
		card: 'rgba(255,255,255,.06)',
		border: 'rgba(255,255,255,.18)',
		shadow: 'rgba(0,0,0,.6)',
	},
};

export const ASPECTS = {
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
	'16:9': { width: 1920, height: 1080 },
	'4:5': { width: 1080, height: 1350 },
};

export function resolvePalette(name) {
	const key = String(name || 'midnight').toLowerCase();
	return PALETTES[key] || PALETTES.midnight;
}

export function themeFor(name, accent) {
	const palette = { ...resolvePalette(name) };
	if (accent) palette.accent = accent;
	return palette;
}

export function safeArea(height) {
	const bottom = Math.round(height - Math.max(300, height * 0.2));
	return { top: Math.round(height * 0.106), bottom };
}