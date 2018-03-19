/**
 * @file Defines the base date picker behavior, overridden by various modes.
 */
import dayPicker from '../views/day-picker';
import monthPicker from '../views/month-picker';
import yearPicker from '../views/year-picker';
import {bufferFn, noop} from '../lib/fns';
import {on, CustomEvent, Key} from '../lib/dom';
import {constrainDate} from '../lib/date-manip';

var views = {
  day: dayPicker,
  year: yearPicker,
  month: monthPicker
};

export default function BaseMode(input, emit, opts) {
  var detatchInputEvents; // A function that detaches all events from the input
  var attachedInputEvents; // An object that contains all attached events on the input
  var closing = false; // A hack to prevent calendar from re-opening when closing.
  var selectedDate; // The currently selected date
  var dp = {
    // The root DOM element for the date picker, initialized on first open.
    el: undefined,
    opts: opts,
    shouldFocusOnBlur: true,
    shouldFocusOnRender: true,
    state: initialState(),
    adjustPosition: noop,
    containerHTML: '<div class="dp"></div>',

    attachToDom: function () {
      document.body.appendChild(dp.el);
    },

    updateInput: function (selectedDate) {
      var e = new CustomEvent('change', {bubbles: true});
      e.simulated = true;
      input.value = selectedDate ? opts.format(selectedDate) : '';
      input.dispatchEvent(e);
    },

    computeSelectedDate: function () {
      return opts.parse(input.value);
    },

    currentView: function() {
      return views[dp.state.view];
    },

    open: function () {
      if (closing) {
        return;
      }

      if (!dp.el) {
        dp.el = createContainerElement(opts, dp.containerHTML);
        attachContainerEvents(dp);
      }

      selectedDate = constrainDate(dp.computeSelectedDate(), opts.min, opts.max);
      dp.state.hilightedDate = selectedDate || opts.hilightedDate;
      dp.state.view = 'day';

      dp.attachToDom();
      dp.render();

      emit('open');
    },

    isVisible: function () {
      return !!dp.el && !!dp.el.parentNode;
    },

    hasFocus: function () {
      return dp.el && dp.el.contains(document.activeElement);
    },

    shouldHide: function () {
      return dp.isVisible();
    },

    close: function (becauseOfBlur) {
      var el = dp.el;

      if (!dp.isVisible()) {
        return;
      }

      if (el) {
        var parent = el.parentNode;
        parent && parent.removeChild(el);
      }

      closing = true;

      if (becauseOfBlur && dp.shouldFocusOnBlur) {
        focusInput(input);
      }

      // When we close, the input often gains refocus, which
      // can then launch the date picker again, so we buffer
      // a bit and don't show the date picker within N ms of closing
      setTimeout(function() {
        closing = false;
      }, 100);

      emit('close');
    },

    destroy: function () {
      dp.close();
      detatchInputEvents();
    },

    detachInputEvent: function (event) {
      var attachedEvent = attachedInputEvents[event];
      if (attachedEvent) {
        attachedEvent();
      }
    },

    render: function () {
      if (!dp.el) {
        return;
      }

      var hadFocus = dp.hasFocus();
      var html = dp.currentView().render(dp);
      html && (dp.el.firstChild.innerHTML = html);

      dp.adjustPosition();

      if (hadFocus || dp.shouldFocusOnRender) {
        focusCurrent(dp);
      }
    },

    // Conceptually similar to setState in React, updates
    // the view state and re-renders.
    setState: function (state) {
      for (var key in state) {
        dp.state[key] = state[key];
      }

      emit('statechange');
      dp.render();
    },
  };

  attachedInputEvents = attachInputEvents(input, dp);

  detatchInputEvents = function() {
    Object.keys(attachedInputEvents).forEach(function (f) {
      attachedInputEvents[f]();
    });
  };


  // Builds the initial view state
  // selectedDate is a special case and causes changes to hilightedDate
  // hilightedDate is set on open, so remains undefined initially
  // view is the current view (day, month, year)
  function initialState() {
    return {
      get selectedDate() {
        return selectedDate;
      },
      set selectedDate(dt) {
        if (dt && !opts.inRange(dt)) {
          return;
        }

        if (dt) {
          selectedDate = new Date(dt);
          dp.state.hilightedDate = selectedDate;
        } else {
          selectedDate = dt;
        }

        dp.updateInput(selectedDate);
        emit('select');
        dp.close();
      },
      view: 'day',
    };
  }

  return dp;
}

function createContainerElement(opts, containerHTML) {
  var el = document.createElement('div');

  el.className = opts.mode;
  el.innerHTML = containerHTML;

  return el;
}

function attachInputEvents(input, dp) {
  var bufferShow = bufferFn(5, function () {
    if (dp.shouldHide()) {
      dp.close();
    } else {
      dp.open();
    }
  });

  var off = {
    blur: on('blur', input, bufferFn(5, function () {
        if (!dp.hasFocus()) {
            dp.close(true);
        }
    })),

    mousedown: on('mousedown', input, function () {
          if (input === document.activeElement) {
              bufferShow();
          }
      }),

    focus: on('focus', input, bufferShow),

    input: on('input', input, function (e) {
        var date = dp.opts.parse(e.target.value);
        isNaN(date) || dp.setState({
            hilightedDate: date
        });
    }),

  };

  return off;
}

function focusCurrent(dp) {
  var current = dp.el.querySelector('.dp-current');
  return current && current.focus();
}

function attachContainerEvents(dp) {
  var el = dp.el;
  var calEl = el.querySelector('.dp');

  function onClick(e) {
    e.target.className.split(' ').forEach(function(evt) {
      var handler = dp.currentView().onClick[evt];
      handler && handler(e, dp);
    });
  }

  on('keydown', el, function (e) {
    if (e.keyCode === Key.enter) {
      onClick(e);
    } else {
      dp.currentView().onKeyDown(e, dp);
    }
  });

  // If the user clicks in non-focusable space, but
  // still within the date picker, we don't want to
  // hide, so we need to hack some things...
  on('mousedown', calEl, function (e) {
    e.target.focus(); // IE hack
    if (document.activeElement !== e.target) {
      e.preventDefault();
      focusCurrent(dp);
    }
  });

  on('click', el, onClick);
}

function focusInput(input) {
  // When the modal closes, we need to focus the original input so the
  // user can continue tabbing from where they left off.
  input.focus();

  // iOS zonks out if we don't blur the input, so...
  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
    input.blur();
  }
}
