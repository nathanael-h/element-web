/*
Copyright 2026 Nathanaël Hannebert

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** The thread list filters, one per tab. Matches the split used by the threads activity centre. */
export enum ThreadFilterType {
    /** Threads the current user took part in. */
    My,
    /** Threads the current user did not take part in. */
    Other,
}
