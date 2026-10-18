// Builds one video per journey from the recorded clips with ffmpeg: title card, one clip per test,
// end card. This file only makes the command lines (pure, tested); record.mjs runs them.

const common = (size, fps) => [
	'-vf',
	`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p`,
	'-c:v',
	'libx264',
	'-preset',
	'veryfast',
	'-crf',
	'23',
	'-an'
];

/** A recorded webm -> an mp4 every clip shares the size, frame rate and codec of. */
export function clipArgs(input, output, size, fps = 25) {
	return ['-y', '-v', 'error', '-i', input, ...common(size, fps), output];
}

/** A still PNG -> `seconds` of mp4. */
export function cardArgs(png, output, size, seconds = 3, fps = 25) {
	return [
		'-y',
		'-v',
		'error',
		'-loop',
		'1',
		'-t',
		String(seconds),
		'-i',
		png,
		...common(size, fps),
		output
	];
}

/** The concat demuxer's list file. */
export function concatList(files) {
	return files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/** Joins same-format mp4s without re-encoding. */
export function concatArgs(listFile, output) {
	return ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', output];
}
