/*
Copyright 2024 New Vector Ltd.
Copyright 2021-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, getByRole } from "test-utils-rtl";
import {
    type MatrixClient,
    type MatrixEvent,
    PendingEventOrdering,
    Room,
    FeatureSupport,
    Thread,
} from "matrix-js-sdk/src/matrix";
import {
    clientAndSDKContextRenderOptions,
    createTestClient,
    getRoomContext,
    mkRoom,
    mockPlatformPeg,
    stubClient,
} from "test-utils";
import { mkThread } from "test-utils/threads";

import ThreadPanel, { ThreadFilterType, ThreadPanelHeader } from "./ThreadPanel";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { _t } from "../../languageHandler";
import { MatrixClientPeg } from "../../MatrixClientPeg";
import { RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import ResizeNotifier from "../../utils/ResizeNotifier";
import { ScopedRoomContextProvider } from "../../contexts/ScopedRoomContext.tsx";
import type { RoomContextType } from "../../contexts/RoomContext.ts";
import { SDKContextClass } from "../../contexts/SDKContextClass.ts";
import PosthogTrackers from "../../PosthogTrackers";

vi.mock("../../utils/Feedback");

describe("ThreadPanel", () => {
    describe("Header", () => {
        it("renders the filter tabs", () => {
            const { asFragment } = render(
                <ThreadPanelHeader filterOption={ThreadFilterType.All} setFilterOption={() => undefined} />,
            );
            expect(asFragment()).toMatchSnapshot();
        });

        it.each([
            { filterOption: ThreadFilterType.All, selected: "All threads", unselected: "My threads" },
            { filterOption: ThreadFilterType.My, selected: "My threads", unselected: "All threads" },
        ])("marks the $selected tab as selected", ({ filterOption, selected, unselected }) => {
            render(<ThreadPanelHeader filterOption={filterOption} setFilterOption={() => undefined} />);
            expect(screen.getByRole("tablist", { name: "Filter threads" })).toBeInTheDocument();
            expect(screen.getByRole("tab", { name: selected, selected: true })).toBeInTheDocument();
            expect(screen.getByRole("tab", { name: unselected, selected: false })).toBeInTheDocument();
        });

        it.each([
            {
                filterOption: ThreadFilterType.My,
                tabName: "All threads",
                expectedFilter: ThreadFilterType.All,
                index: 0,
            },
            {
                filterOption: ThreadFilterType.All,
                tabName: "My threads",
                expectedFilter: ThreadFilterType.My,
                index: 1,
            },
        ])(
            "selects and tracks the $tabName filter when its tab is clicked",
            ({ filterOption, tabName, expectedFilter, index }) => {
                const trackSpy = vi.spyOn(PosthogTrackers, "trackInteraction");
                const setFilterOption = vi.fn();
                render(<ThreadPanelHeader filterOption={filterOption} setFilterOption={setFilterOption} />);
                fireEvent.click(screen.getByRole("tab", { name: tabName }));
                expect(setFilterOption).toHaveBeenCalledWith(expectedFilter);
                expect(trackSpy).toHaveBeenCalledWith(
                    "WebRightPanelThreadPanelFilterDropdown",
                    expect.objectContaining({ type: "click" }),
                    index,
                );
            },
        );

        it("sends an unthreaded read receipt when the Mark All Threads Read button is clicked", async () => {
            const mockClient = createTestClient();
            const mockEvent = {} as MatrixEvent;
            const mockRoom = mkRoom(mockClient, "!roomId:example.org");
            mockRoom.getLastLiveEvent.mockReturnValue(mockEvent);
            const roomContextObject = {
                room: mockRoom,
            } as unknown as RoomContextType;
            const { container } = render(
                <ScopedRoomContextProvider {...roomContextObject}>
                    <MatrixClientContext.Provider value={mockClient}>
                        <ThreadPanelHeader filterOption={ThreadFilterType.All} setFilterOption={() => undefined} />
                    </MatrixClientContext.Provider>
                </ScopedRoomContextProvider>,
            );
            fireEvent.click(getByRole(container, "button", { name: "Mark all as read" }));
            await waitFor(() =>
                expect(mockClient.sendReadReceipt).toHaveBeenCalledWith(mockEvent, expect.anything(), true),
            );
        });

        it("doesn't send a receipt if no room is in context", async () => {
            const mockClient = createTestClient();
            const { container } = render(
                <MatrixClientContext.Provider value={mockClient}>
                    <ThreadPanelHeader filterOption={ThreadFilterType.All} setFilterOption={() => undefined} />
                </MatrixClientContext.Provider>,
            );
            fireEvent.click(getByRole(container, "button", { name: "Mark all as read" }));
            await waitFor(() => expect(mockClient.sendReadReceipt).not.toHaveBeenCalled());
        });
    });

    describe("Filtering", () => {
        const ROOM_ID = "!roomId:example.org";
        const SENDER = "@alice:example.org";

        let mockClient: MatrixClient;
        let room: Room;

        const TestThreadPanel = () => (
            <MatrixClientContext.Provider value={mockClient}>
                <ScopedRoomContextProvider
                    {...getRoomContext(room, {
                        canSendMessages: true,
                    })}
                >
                    <ThreadPanel
                        roomId={ROOM_ID}
                        onClose={vi.fn()}
                        resizeNotifier={new ResizeNotifier()}
                        permalinkCreator={new RoomPermalinkCreator(room)}
                    />
                </ScopedRoomContextProvider>
            </MatrixClientContext.Provider>
        );

        beforeEach(async () => {
            vi.clearAllMocks();

            stubClient();
            mockPlatformPeg();
            mockClient = vi.mocked(MatrixClientPeg.safeGet());
            Thread.setServerSideSupport(FeatureSupport.Stable);
            Thread.setServerSideListSupport(FeatureSupport.Stable);
            Thread.setServerSideFwdPaginationSupport(FeatureSupport.Stable);
            vi.spyOn(mockClient, "supportsThreads").mockReturnValue(true);

            room = new Room(ROOM_ID, mockClient, mockClient.getUserId() ?? "", {
                pendingEventOrdering: PendingEventOrdering.Detached,
            });
            vi.spyOn(room, "fetchRoomThreads").mockReturnValue(Promise.resolve());
            vi.spyOn(mockClient, "getRoom").mockReturnValue(room);
            await room.createThreadsTimelineSets();
            const [allThreads, myThreads] = room.threadsTimelineSets;
            vi.spyOn(room, "createThreadsTimelineSets").mockReturnValue(Promise.resolve([allThreads!, myThreads!]));
        });

        function toggleThreadFilter(container: HTMLElement, newFilter: ThreadFilterType) {
            const name = newFilter === ThreadFilterType.My ? "My threads" : "All threads";
            fireEvent.click(getByRole(container, "tab", { name }));
        }

        type EventData = { sender: string | null; content: string | null };

        function findEvents(container: HTMLElement): EventData[] {
            return Array.from(container.querySelectorAll(".mx_EventTile")).map((el) => {
                const sender = el.querySelector(".mx_DisambiguatedProfile_displayName")?.textContent ?? null;
                const content = el.querySelector('[data-testid="event-tile-slot-body"]')?.textContent ?? null;
                return { sender, content };
            });
        }

        function toEventData(event: MatrixEvent): EventData {
            return { sender: event.event.sender ?? null, content: event.event.content?.body ?? null };
        }

        it("correctly filters Thread List with multiple threads", async () => {
            const otherThread = mkThread({
                room,
                client: mockClient,
                authorId: SENDER,
                participantUserIds: [mockClient.getUserId()!],
            });

            const mixedThread = mkThread({
                room,
                client: mockClient,
                authorId: SENDER,
                participantUserIds: [SENDER, mockClient.getUserId()!],
            });

            const ownThread = mkThread({
                room,
                client: mockClient,
                authorId: mockClient.getUserId()!,
                participantUserIds: [mockClient.getUserId()!],
            });

            const threadRoots = [otherThread.rootEvent, mixedThread.rootEvent, ownThread.rootEvent];
            vi.spyOn(mockClient, "fetchRoomEvent").mockImplementation((_, eventId) => {
                const event = threadRoots.find((it) => it.getId() === eventId)?.event;
                return event ? Promise.resolve(event) : Promise.reject();
            });
            const [allThreads, myThreads] = room.threadsTimelineSets;
            allThreads!.addLiveEvent(otherThread.rootEvent, { addToState: true });
            allThreads!.addLiveEvent(mixedThread.rootEvent, { addToState: true });
            allThreads!.addLiveEvent(ownThread.rootEvent, { addToState: true });
            myThreads!.addLiveEvent(mixedThread.rootEvent, { addToState: true });
            myThreads!.addLiveEvent(ownThread.rootEvent, { addToState: true });

            const renderResult = render(
                <TestThreadPanel />,
                clientAndSDKContextRenderOptions(createTestClient(), SDKContextClass.instance),
            );
            await waitFor(() => expect(renderResult.container.querySelector(".mx_AutoHideScrollbar")).toBeFalsy());
            await waitFor(() => {
                const events = findEvents(renderResult.container);
                expect(events).toHaveLength(3);
                expect(events[0]).toEqual(toEventData(otherThread.rootEvent));
                expect(events[1]).toEqual(toEventData(mixedThread.rootEvent));
                expect(events[2]).toEqual(toEventData(ownThread.rootEvent));
            });
            await waitFor(() => expect(getByRole(renderResult.container, "tablist")).toBeInTheDocument());
            toggleThreadFilter(renderResult.container, ThreadFilterType.My);
            await waitFor(() => expect(renderResult.container.querySelector(".mx_AutoHideScrollbar")).toBeFalsy());
            await waitFor(() => {
                const events = findEvents(renderResult.container);
                expect(events).toHaveLength(2);
                expect(events[0]).toEqual(toEventData(mixedThread.rootEvent));
                expect(events[1]).toEqual(toEventData(ownThread.rootEvent));
            });
            toggleThreadFilter(renderResult.container, ThreadFilterType.All);
            await waitFor(() => expect(renderResult.container.querySelector(".mx_AutoHideScrollbar")).toBeFalsy());
            await waitFor(() => {
                const events = findEvents(renderResult.container);
                expect(events).toHaveLength(3);
                expect(events[0]).toEqual(toEventData(otherThread.rootEvent));
                expect(events[1]).toEqual(toEventData(mixedThread.rootEvent));
                expect(events[2]).toEqual(toEventData(ownThread.rootEvent));
            });
        });

        it("correctly filters Thread List with a single, unparticipated thread", async () => {
            const otherThread = mkThread({
                room,
                client: mockClient,
                authorId: SENDER,
                participantUserIds: [mockClient.getUserId()!],
            });

            const threadRoots = [otherThread.rootEvent];
            vi.spyOn(mockClient, "fetchRoomEvent").mockImplementation((_, eventId) => {
                const event = threadRoots.find((it) => it.getId() === eventId)?.event;
                return event ? Promise.resolve(event) : Promise.reject();
            });
            const [allThreads] = room.threadsTimelineSets;
            allThreads!.addLiveEvent(otherThread.rootEvent, { addToState: true });

            const renderResult = render(
                <TestThreadPanel />,
                clientAndSDKContextRenderOptions(createTestClient(), SDKContextClass.instance),
            );
            await waitFor(() => expect(renderResult.container.querySelector(".mx_AutoHideScrollbar")).toBeFalsy());
            await waitFor(() => {
                const events = findEvents(renderResult.container);
                expect(events).toHaveLength(1);
                expect(events[0]).toEqual(toEventData(otherThread.rootEvent));
            });
            await waitFor(() => expect(getByRole(renderResult.container, "tablist")).toBeInTheDocument());
            toggleThreadFilter(renderResult.container, ThreadFilterType.My);
            await waitFor(() => expect(renderResult.container.querySelector(".mx_AutoHideScrollbar")).toBeFalsy());
            await waitFor(() => {
                const events = findEvents(renderResult.container);
                expect(events).toHaveLength(0);
            });
            toggleThreadFilter(renderResult.container, ThreadFilterType.All);
            await waitFor(() => expect(renderResult.container.querySelector(".mx_AutoHideScrollbar")).toBeFalsy());
            await waitFor(() => {
                const events = findEvents(renderResult.container);
                expect(events).toHaveLength(1);
                expect(events[0]).toEqual(toEventData(otherThread.rootEvent));
            });
        });

        it("shows a spinner rather than the empty state while threads are loading", () => {
            vi.mocked(room.fetchRoomThreads).mockReturnValue(new Promise(() => {}));
            const { container } = render(
                <TestThreadPanel />,
                clientAndSDKContextRenderOptions(createTestClient(), SDKContextClass.instance),
            );
            expect(container.querySelector(".mx_Spinner")).toBeInTheDocument();
            expect(screen.queryByText(_t("threads|empty_title"))).not.toBeInTheDocument();
        });

        it("shows the empty state without tabs when the room has no threads", async () => {
            render(<TestThreadPanel />, clientAndSDKContextRenderOptions(createTestClient(), SDKContextClass.instance));
            await waitFor(() => expect(screen.getByText(_t("threads|empty_title"))).toBeInTheDocument());
            expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
            expect(screen.queryByRole("tabpanel", { name: "All threads" })).not.toBeInTheDocument();
        });

        it("labels the thread list with the selected tab", async () => {
            const thread = mkThread({
                room,
                client: mockClient,
                authorId: SENDER,
                participantUserIds: [mockClient.getUserId()!],
            });
            vi.spyOn(mockClient, "fetchRoomEvent").mockResolvedValue(thread.rootEvent.event);
            room.threadsTimelineSets[0]!.addLiveEvent(thread.rootEvent, { addToState: true });

            render(<TestThreadPanel />, clientAndSDKContextRenderOptions(createTestClient(), SDKContextClass.instance));
            await waitFor(() => expect(screen.getByRole("tabpanel", { name: "All threads" })).toBeInTheDocument());
            fireEvent.click(screen.getByRole("tab", { name: "My threads" }));
            await waitFor(() => expect(screen.getByRole("tabpanel", { name: "My threads" })).toBeInTheDocument());
        });
    });
});
