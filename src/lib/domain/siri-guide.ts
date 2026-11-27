/** Step-by-step iPhone Shortcuts setup (hub-6tr.2), as data so tests and the page share it. */

export const TOKEN_PLACEHOLDER = '<paste the token you saved>';

export interface GuideCopy {
	/** Short label for the copy button, e.g. "Copy URL". */
	label: string;
	value: string;
}

export interface GuideStep {
	/** The iOS Shortcuts action to add, as named in the app. */
	action: string;
	/** What to set on it. */
	detail: string;
	copy?: GuideCopy[];
}

export interface GuideShortcut {
	id: 'list' | 'star-job' | 'photo';
	name: string;
	/** How it is started: a Siri phrase, or the Share Sheet. */
	hint: string;
	steps: GuideStep[];
}

export const authHeader = (token: string | null) => `Bearer ${token || TOKEN_PLACEHOLDER}`;

export function buildGuide(origin: string, token: string | null): GuideShortcut[] {
	const header: GuideCopy = { label: 'Copy header value', value: authHeader(token) };
	const post = (path: string, body: string, bodyDetail: string): GuideStep => ({
		action: 'Get Contents of URL',
		detail:
			`Set the URL, tap Show More, set Method to POST, add the header Authorization with the value below, ` +
			`set Request Body to JSON and add ${bodyDetail}.`,
		copy: [{ label: 'Copy URL', value: `${origin}${path}` }, header]
	});
	return [
		{
			id: 'list',
			name: 'Add to the hub list',
			hint: 'Say: "Hey Siri, Add to the hub list"',
			steps: [
				{
					action: 'Ask for Input',
					detail: 'Input Type: Text. Question: "What should I add?"'
				},
				{
					action: 'Get Contents of URL',
					detail:
						'Set the URL, tap Show More, leave Method as GET and add the header Authorization with the value below.',
					copy: [{ label: 'Copy URL', value: `${origin}/api/siri/lists` }, header]
				},
				{ action: 'Get Dictionary Value', detail: 'Get Value for "lists" in Contents of URL.' },
				{
					action: 'Choose from List',
					detail: 'Prompt: "Which list?". Choose from the Dictionary Value.'
				},
				post(
					'/api/siri/list-item',
					'',
					'a Text field "list" (the Chosen Item) and a Text field "item" (the Provided Input from the first step)'
				),
				{ action: 'Get Dictionary Value', detail: 'Get Value for "speak" in Contents of URL.' },
				{ action: 'Speak Text', detail: 'Speak the Dictionary Value.' }
			]
		},
		{
			id: 'star-job',
			name: 'New Star Job',
			hint: 'Say: "Hey Siri, New Star Job"',
			steps: [
				{ action: 'Ask for Input', detail: 'Input Type: Text. Question: "What is the job?"' },
				{
					action: 'Ask for Input',
					detail: 'Input Type: Number. Question: "How many stars?". Default Answer: 1.'
				},
				{
					action: 'Ask for Input',
					detail: 'Optional. Input Type: Text. Question: "Which kid?". Skip it if you have one kid.'
				},
				post(
					'/api/siri/star-job',
					'',
					'a Text field "title" (the job), a Number field "stars" and, if you asked, a Text field "kid"'
				),
				{ action: 'Get Dictionary Value', detail: 'Get Value for "speak" in Contents of URL.' },
				{ action: 'Speak Text', detail: 'Speak the Dictionary Value.' }
			]
		},
		{
			id: 'photo',
			name: 'Send to the hub',
			hint: 'In Photos, select photos, tap Share, then Send to the hub.',
			steps: [
				{
					action: 'Receive Images',
					detail:
						'Tap the shortcut name at the top, turn on Show in Share Sheet, and set it to receive Images from the Share Sheet.'
				},
				{ action: 'Repeat with Each', detail: 'Repeat with each item in Shortcut Input.' },
				{
					action: 'Convert Image',
					detail: 'Convert Repeat Item to JPEG, with Preserve Metadata off.'
				},
				{
					action: 'Get Contents of URL',
					detail:
						'Set the URL, tap Show More, set Method to POST, add the header Authorization with the value below ' +
						'and the header Content-Type with the value image/jpeg, then set Request Body to File and pick the ' +
						'Converted Image. To put each photo on the wall at once, add ?show=1 to the end of the URL.',
					copy: [{ label: 'Copy URL', value: `${origin}/api/siri/photo` }, header]
				},
				{
					action: 'Show Notification',
					detail: 'After End Repeat, show "Sent to the hub" so you know it worked.'
				}
			]
		}
	];
}
