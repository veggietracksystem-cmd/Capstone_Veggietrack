import { tr } from '../i18n/translate';
// Getters so the text follows the selected language at the moment it is shown.
export const POD_MESSAGES = {
  get upload() { return tr('misc.podUpload'); },
  get completion() { return tr('misc.podCompletion'); },
  // The pre-flight runs before anything is uploaded, so this must never imply
  // a photo was sent — nothing was.
  get precheck() { return tr('misc.podPrecheck'); },
  get unreachable() { return tr('errors.connection'); },
  get offline() { return tr('misc.podOffline'); },
  get session() { return tr('errors.sessionEnded'); },
  get timeout() { return tr('misc.podTimeout'); },
};

export function proofFailureMessage(error) {
  if (error?.code === 'OFFLINE') return POD_MESSAGES.offline;
  if (error?.stage === 'upload') return POD_MESSAGES.upload;
  if (error?.status === 401) return POD_MESSAGES.session;
  if (error?.code === 'BACKEND_UNREACHABLE') return POD_MESSAGES.unreachable;
  if (error?.stage === 'complete' || error?.stage === 'precheck') {
    const prefix = error.stage === 'precheck' ? POD_MESSAGES.precheck : POD_MESSAGES.completion;
    // Keep precise backend validation/rejection details; never label a 4xx as network failure.
    const detail = error.code === 'REQUEST_TIMEOUT' ? POD_MESSAGES.timeout : error.status >= 400 && error.status < 500 ? error.data?.error : null;
    return detail ? `${prefix}\n\n${detail}` : prefix;
  }
  return error?.message || POD_MESSAGES.upload;
}

const isDeliveryConfirmed = (result) =>
  !!result && (result.status === 'delivered' || ['Delivery marked as completed', 'Delivery already completed'].includes(result.message));

// One controller belongs to one delivery/pickup completion screen. The same
// photo reuses its successful upload after a rejected/timed-out completion;
// replacing it resets it. `isConfirmed` lets pickup completion (different
// success message shape) reuse this same controller instead of duplicating it.
export function createProofSubmission({ upload, complete, isOnline, precheck, isConfirmed = isDeliveryConfirmed }) {
  let inFlight = null;
  let uploadedPhoto = null;
  let uploadedUrl = null;
  let completed = null;
  return {
    submit({ photo, getLocation }) {
      if (completed) return Promise.resolve(completed);
      if (inFlight) return inFlight;
      inFlight = (async () => {
        if (!photo?.uri) throw new Error('Please take a delivery photo before completing the delivery.');
        if (!(await isOnline())) throw Object.assign(new Error(POD_MESSAGES.offline), { code: 'OFFLINE' });
        // Fresh verification on every attempt, without discarding the image.
        const preflight = await getLocation();
        if (precheck && (uploadedPhoto !== photo || !uploadedUrl)) {
          // Ask the server whether this completion would be accepted before a single
          // byte reaches Cloudinary: a rejection here strands no image. Skipped once
          // a photo is already hosted — that cost is spent and complete() re-checks.
          try { await precheck(preflight); }
          catch (error) {
            // A backend without this route answers with the generic JSON 404, which
            // carries no code. Never block a completion the real endpoint would accept.
            if (error.status !== 404 || error.code) {
              error.stage = 'precheck';
              if (error.status === 0 && !(await isOnline())) error.code = 'OFFLINE';
              throw error;
            }
          }
        }
        if (uploadedPhoto !== photo || !uploadedUrl) {
          try { uploadedUrl = await upload(photo); uploadedPhoto = photo; }
          catch (error) {
            error.stage = 'upload';
            if (!(await isOnline())) error.code = 'OFFLINE';
            throw error;
          }
        }
        // An upload may take tens of seconds. Refresh again for server validation.
        const location = await getLocation();
        try {
          const result = await complete({ proof_photo_url: uploadedUrl, ...location });
          if (!isConfirmed(result)) {
            throw Object.assign(new Error('We couldn’t confirm this delivery was marked as done.'), { code: 'COMPLETION_UNCONFIRMED' });
          }
          completed = result;
          return completed;
        } catch (error) {
          error.stage = 'complete';
          if (error.status === 0 && !(await isOnline())) error.code = 'OFFLINE';
          throw error;
        }
      })().finally(() => { inFlight = null; });
      return inFlight;
    },
    isSubmitting: () => !!inFlight,
  };
}
