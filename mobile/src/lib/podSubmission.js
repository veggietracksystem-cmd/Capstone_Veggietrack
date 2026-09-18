export const POD_MESSAGES = {
  upload: 'Unable to upload proof of delivery. Please try again.',
  completion: 'Proof was uploaded, but the delivery could not be completed. Please try again.',
  unreachable: 'Server cannot be reached. Check your connection and try again.',
  offline: 'You appear to be offline. Reconnect and try again.',
  session: 'Your session has expired. Sign in again and try again.',
  timeout: 'The request timed out. Please try again.',
};

export function proofFailureMessage(error) {
  if (error?.code === 'OFFLINE') return POD_MESSAGES.offline;
  if (error?.stage === 'upload') return POD_MESSAGES.upload;
  if (error?.status === 401) return POD_MESSAGES.session;
  if (error?.code === 'BACKEND_UNREACHABLE') return POD_MESSAGES.unreachable;
  if (error?.stage === 'complete') {
    // Keep precise backend validation/rejection details; never label a 4xx as network failure.
    const detail = error.code === 'REQUEST_TIMEOUT' ? POD_MESSAGES.timeout : error.status >= 400 && error.status < 500 ? error.data?.error : null;
    return detail ? `${POD_MESSAGES.completion}\n\n${detail}` : POD_MESSAGES.completion;
  }
  return error?.message || POD_MESSAGES.upload;
}

const isDeliveryConfirmed = (result) =>
  !!result && (result.status === 'delivered' || ['Delivery marked as completed', 'Delivery already completed'].includes(result.message));

// One controller belongs to one delivery/pickup completion screen. The same
// photo reuses its successful upload after a rejected/timed-out completion;
// replacing it resets it. `isConfirmed` lets pickup completion (different
// success message shape) reuse this same controller instead of duplicating it.
export function createProofSubmission({ upload, complete, isOnline, isConfirmed = isDeliveryConfirmed }) {
  let inFlight = null;
  let uploadedPhoto = null;
  let uploadedUrl = null;
  let completed = null;
  return {
    submit({ photo, getLocation }) {
      if (completed) return Promise.resolve(completed);
      if (inFlight) return inFlight;
      inFlight = (async () => {
        if (!photo?.uri) throw new Error('Select a proof photo before completing the delivery.');
        if (!(await isOnline())) throw Object.assign(new Error(POD_MESSAGES.offline), { code: 'OFFLINE' });
        // Fresh verification on every attempt, without discarding the image.
        await getLocation();
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
            throw Object.assign(new Error('The server did not confirm delivery completion.'), { code: 'COMPLETION_UNCONFIRMED' });
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
