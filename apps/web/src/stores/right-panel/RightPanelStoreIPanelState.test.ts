/*
Copyright 2026 Nathanaël Hannebert

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import { convertToStatePanel, convertToStorePanel } from "./RightPanelStoreIPanelState";
import { RightPanelPhases } from "./RightPanelStorePhases";
import { ThreadFilterType } from "../../components/structures/ThreadFilterType";

describe("RightPanelStoreIPanelState", () => {
    it("keeps the selected thread list tab when the panel is stored and restored", () => {
        const room = { findEventById: () => undefined, getMember: () => null } as unknown as Room;

        const stored = convertToStorePanel({
            isOpen: true,
            history: [{ phase: RightPanelPhases.ThreadPanel, state: { threadListFilter: ThreadFilterType.Other } }],
        });
        const restored = convertToStatePanel(stored, room);

        expect(restored?.history[0].state?.threadListFilter).toBe(ThreadFilterType.Other);
    });
});
