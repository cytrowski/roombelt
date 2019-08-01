import cancellationToken from "utils/cancellation-token";
import screenfull from "screenfull";
import axios from "axios";
import ms from "ms";

import * as api from "services/api";
import { createDevice, getDeviceDetails, removeDevice } from "services/api";

import {
  calendarNameSelector,
  currentActionSelector,
  currentMeetingSelector,
  isCalendarSelectedSelector,
  isDashboardDeviceSelector,
  isDeviceRemovedSelector,
  isInitializedSelector,
  isInOfflineModeSelector,
  isSubscriptionCancelledSelector,
  lastActivityOnShowCalendarsViewSelector,
  minutesLeftForCheckInSelector,
  showAllCalendarsViewSelector
} from "./selectors";
import { changeLanguage } from "i18n";

import i18next from "i18next";
import { wait, waitUntilTrue } from "utils/time";

import { $updateClock } from "./state/timestamp/timestamp.duck";
import { $startClock } from "./state/timestamp/timestamp.thunks";

import { $updateDeviceData } from "./state/device/device.duck";

import {
  $setActionSource,
  $startAction,
  $setActionIsRetrying,
  $setActionError,
  $setActionSuccess,
  endAction
} from "./state/currentMeetingActions/currentMeetingActions.duck";

import {
  $markInitialized,
  $markRemoved,
  $setIsSubscriptionCancelled,
  $updateOfflineStatus,
  $updateShowAllCalendarsView,
  $allCalendarsViewActivity
} from "./state/appState/appState.duck";

import {
  $updateFullScreenState,
  $changeFontSize,
} from './state/displayOptions/displayOptions.duck'

const $initializeApiVersionObserver = () => async () => {
  let currentVersion = undefined;

  const checkVersion = async () => {
    const response = await api.getApiVersion();

    if (response && response.version && currentVersion && currentVersion !== response.version) {
      window.location.reload();
    }

    if (response) {
      currentVersion = response.version;
    }
  };

  setInterval(checkVersion, 1000 * 60 * 5);
  await checkVersion();
}

const $initializeFullScreenSupport = () => dispatch => {
  const updateStatus = () => {
    dispatch($updateFullScreenState(screenfull.enabled, screenfull.isFullscreen));
  };

  updateStatus();

  if (typeof screenfull.onchange === "function") {
    screenfull.onchange(updateStatus);
  }
}

export const deviceActions = {
  initialize: () => async (dispatch, getState) => {
    if (isInitializedSelector(getState())) {
      return;
    }

    dispatch($initializeApiVersionObserver());
    dispatch($markInitialized());

    try {
      await getDeviceDetails();
    } catch (error) {
      if (error.response && error.response.status === 403) {
        await createDevice();
      }
    }

    dispatch($startClock());
    dispatch(deviceActions.$fetchDeviceData());
    dispatch($initializeFullScreenSupport());
    dispatch(deviceActions.$initializeOfflineObserver());
  },

  $fetchDeviceData: () => async (dispatch, getState) => {
    const token = cancellationToken(deviceActions.$fetchDeviceData).cancelOthers();

    try {
      const shouldGetAllCalendars = showAllCalendarsViewSelector(getState());
      const device = await getDeviceDetails(shouldGetAllCalendars);

      if (device.version && device.version !== window.version) {
        window.location.reload();
      }

      if (token.isCancelled()) {
        return;
      }

      changeLanguage(device.language);

      dispatch($updateDeviceData(device));
      dispatch($setIsSubscriptionCancelled(false));
      dispatch(deviceActions.$removeCurrentMeetingIfNotCheckedIn());
    } catch (error) {
      if (error.response && error.response.status === 404) {
        dispatch($markRemoved());
      }
      if (error.response && error.response.status === 402) {
        dispatch($setIsSubscriptionCancelled(true));
      }
    }

    const timeout = (function() {
      const state = getState();

      if (isDeviceRemovedSelector(state)) return ms("1 year");
      if (isSubscriptionCancelledSelector(state)) return ms("10 min");
      if (isDashboardDeviceSelector(state) || isCalendarSelectedSelector(state)) return ms("30s");

      return ms("5s");
    })();

    await wait(timeout);

    if (token.isCancelled()) {
      return;
    }

    dispatch(deviceActions.$fetchDeviceData());
  },
  $removeCurrentMeetingIfNotCheckedIn: () => async (dispatch, getState) => {
    const state = getState();
    const minutesLeftForCheckIn = minutesLeftForCheckInSelector(state);
    const meeting = currentMeetingSelector(state);

    if (minutesLeftForCheckIn !== null && minutesLeftForCheckIn < 0) {
      await api.deleteMeeting(meeting.id, true);
      dispatch(deviceActions.$fetchDeviceData());
    }
  },

  $updateClock,
  
  toggleFullScreen: () => () => {
    if (screenfull.enabled) {
      screenfull.toggle();
    }
  },

  // TODO - find all usages of changeFontSize and rename it to $changeFontSize
  changeFontSize: $changeFontSize,

  $initializeOfflineObserver: () => (dispatch, getState) => {
    const successCallback = result => {
      if (isInOfflineModeSelector(getState())) {
        dispatch(meetingActions.endAction());
        dispatch($updateOfflineStatus(false));
      }

      return result;
    };

    const errorCallback = error => {
      if (error.response === undefined && !isInOfflineModeSelector(getState())) {
        dispatch($updateOfflineStatus(true));
      }

      return Promise.reject(error);
    };

    axios.interceptors.response.use(successCallback, errorCallback);
  },

  disconnectDevice: () => async () => {
    await removeDevice();
    window.location.reload();
  },

  $updateShowAllCalendarsView,
  $allCalendarsViewActivity,

  showAllCalendarsView: () => async (dispatch, getState) => {
    dispatch(deviceActions.$updateShowAllCalendarsView(true));
    dispatch(deviceActions.$allCalendarsViewActivity());
    dispatch(deviceActions.$fetchDeviceData());

    await waitUntilTrue(() => lastActivityOnShowCalendarsViewSelector(getState()) < Date.now() - 30 * 1000);

    dispatch(deviceActions.closeAllCalendarsView());
  },

  closeAllCalendarsView: () => dispatch => {
    dispatch(meetingActions.endAction());
    dispatch(deviceActions.$updateShowAllCalendarsView(false));
  }
};

export const meetingActions = {
  endAction,
  $setActionSource,
  $setActionIsRetrying,

  retry: () => (dispatch, getState) => {
    dispatch(meetingActions.$setActionIsRetrying());
    dispatch(currentActionSelector(getState()));
  },

  createMeeting: timeInMinutes => (dispatch, getState) => {
    dispatch($startAction(meetingActions.createMeeting(timeInMinutes)));

    const roomName = calendarNameSelector(getState());
    const createMeetingPromise = api.createMeeting(
      timeInMinutes,
      i18next.t("meeting.quick-meeting-title", { roomName })
    );

    dispatch(meetingActions.$handleMeetingActionPromise(createMeetingPromise));
  },

  cancelMeeting: () => async (dispatch, getState) => {
    dispatch($startAction(meetingActions.cancelMeeting()));

    const currentMeetingId = currentMeetingSelector(getState()).id;
    const deleteMeetingPromise = api.deleteMeeting(currentMeetingId, false);

    dispatch(meetingActions.$handleMeetingActionPromise(deleteMeetingPromise));
  },

  endMeeting: () => dispatch => {
    dispatch($startAction(meetingActions.endMeeting()));

    dispatch(meetingActions.$updateCurrentMeeting({ endNow: true }));
  },

  checkInToMeeting: () => dispatch => {
    dispatch($startAction(meetingActions.checkInToMeeting()));

    dispatch(meetingActions.$updateCurrentMeeting({ checkIn: true }));
  },

  extendMeeting: timeInMinutes => async dispatch => {
    dispatch($startAction(meetingActions.extendMeeting(timeInMinutes)));

    dispatch(meetingActions.$updateCurrentMeeting({ extensionTime: timeInMinutes }));
  },

  startMeetingEarly: () => async dispatch => {
    dispatch($startAction(meetingActions.startMeetingEarly()));

    dispatch(meetingActions.$updateCurrentMeeting({ checkIn: true, startNow: true }));
  },

  $updateCurrentMeeting: options => (dispatch, getState) => {
    const currentMeetingId = currentMeetingSelector(getState()).id;
    const updateMeetingPromise = api.updateMeeting(currentMeetingId, options);

    dispatch(meetingActions.$handleMeetingActionPromise(updateMeetingPromise));
  },

  $handleMeetingActionPromise: actionPromise => async dispatch => {
    try {
      await actionPromise;

      dispatch($updateDeviceData(await getDeviceDetails()));
      dispatch(meetingActions.endAction());
    } catch (error) {
      console.error(error);

      dispatch($updateDeviceData(await getDeviceDetails()));
      dispatch($setActionError(error && error.response && error.response.status));
    }
  },

  createMeetingInAnotherRoom: (calendarId, timeInMinutes) => async (dispatch, getState) => {
    dispatch($startAction(meetingActions.createMeetingInAnotherRoom(calendarId, timeInMinutes)));

    const roomName = calendarNameSelector(getState(), { calendarId });

    try {
      await api.createMeeting(timeInMinutes, i18next.t("meeting.quick-meeting-title", { roomName }), calendarId);

      dispatch($updateDeviceData(await getDeviceDetails(true)));
      dispatch($setActionSuccess());
    } catch (error) {
      console.error(error);
      dispatch($setActionError());
    }
  }
};
