import sharp from 'sharp';

/** Synthetic test image: left half red, right half blue, so rotation is observable. No real photos. */
export async function syntheticJpeg(
	width: number,
	height: number,
	opts: { orientation?: number; takenAt?: string } = {}
): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
		<rect width="${width}" height="${height}" fill="#c33"/>
		<rect x="${width / 2}" width="${width / 2}" height="${height}" fill="#36c"/></svg>`;
	let img = sharp(Buffer.from(svg));
	if (opts.takenAt) img = img.withExif({ IFD2: { DateTimeOriginal: opts.takenAt } });
	if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
	return img.jpeg({ quality: 80 }).toBuffer();
}
