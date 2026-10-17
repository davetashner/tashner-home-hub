import {
	isSoftwareRenderer,
	PALETTE_SLOTS,
	waveShape,
	type PaletteValues,
	type Rgb
} from '#lib/domain/wave-background.js';
import { FRAGMENT, VERTEX } from './wave-shader.js';

export interface WaveRenderer {
	resize(width: number, height: number): void;
	draw(time: number, palette: PaletteValues): void;
	destroy(): void;
}

const UNIFORMS = (
	'uRes uTime uAmp uCols uRows uDot uBg0 uBg1 uBg2 uBloom uSheetA uSheetB uLine uDotC ' +
	'uSheetAlpha uLineAlpha uDotAlpha uVignette'
).split(' ');
/** Uniform for each PALETTE_SLOTS entry, in order. */
const COLOR_UNIFORMS = 'uBg0 uBg1 uBg2 uBloom uSheetA uSheetB uLine uDotC'.split(' ');

/** WebGL1 renderer drawing one full-screen triangle; null when WebGL or the shader is unavailable. */
export function createWaveRenderer(canvas: HTMLCanvasElement): WaveRenderer | null {
	// Automated browsers (e2e) report generic GPU names and have no real GPU: keep the still gradient.
	if (navigator.webdriver) return null;
	const gl = canvas.getContext('webgl', {
		antialias: false,
		alpha: false,
		powerPreference: 'low-power'
	});
	if (!gl) return null;
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	// A GPU we can't name is treated like a CPU renderer: the still gradient is the safe choice.
	if (!info || isSoftwareRenderer(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)))) {
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return null;
	}
	const program = gl.createProgram();
	const shaders = [
		[gl.VERTEX_SHADER, VERTEX],
		[gl.FRAGMENT_SHADER, FRAGMENT]
	].map(([type, src]) => {
		const s = gl.createShader(type as number)!;
		gl.shaderSource(s, src as string);
		gl.compileShader(s);
		return s;
	});
	const destroy = () => {
		shaders.forEach((s) => gl.deleteShader(s));
		gl.deleteProgram(program);
		gl.getExtension('WEBGL_lose_context')?.loseContext();
	};
	if (shaders.some((s) => !gl.getShaderParameter(s, gl.COMPILE_STATUS))) {
		destroy();
		return null;
	}
	shaders.forEach((s) => gl.attachShader(program, s));
	gl.linkProgram(program);
	gl.useProgram(program);
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	const loc = gl.getAttribLocation(program, 'a');
	gl.enableVertexAttribArray(loc);
	gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
	const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]));

	return {
		resize(width, height) {
			canvas.width = width;
			canvas.height = height;
			gl.viewport(0, 0, width, height);
		},
		draw(time, { colors, look }) {
			gl.uniform2f(u.uRes, canvas.width, canvas.height);
			gl.uniform1f(u.uTime, time);
			gl.uniform1f(u.uAmp, waveShape.amp);
			gl.uniform1f(u.uCols, waveShape.cols);
			gl.uniform1f(u.uRows, waveShape.rows);
			gl.uniform1f(u.uDot, waveShape.dot);
			PALETTE_SLOTS.forEach((_, i) => gl.uniform3fv(u[COLOR_UNIFORMS[i]], colors[i] as Rgb));
			gl.uniform1f(u.uSheetAlpha, look.sheetAlpha);
			gl.uniform1f(u.uLineAlpha, look.lineAlpha);
			gl.uniform1f(u.uDotAlpha, look.dotAlpha);
			gl.uniform1f(u.uVignette, look.vignette);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		},
		destroy
	};
}
