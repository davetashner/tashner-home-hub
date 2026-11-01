/** Row shapes the drawing pad's picker panels share with the sheet. */
export interface SavedRow {
	id: string;
	memberId: string;
	memberName: string;
	memberColor: string;
	memberAvatar: string | null;
	thumb: string;
}

export interface PhotoRow {
	id: string;
	w: number | null;
	h: number | null;
}
