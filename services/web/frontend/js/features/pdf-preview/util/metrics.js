import { v4 as uuid } from 'uuid'
import { sendMB } from '../../../infrastructure/event-tracking'
import getMeta from '../../../utils/meta'

// VERSION should get incremented when making changes to caching behavior or
//  adjusting metrics collection.
// Keep in sync with the service worker.
const VERSION = 3

const pdfJsMetrics = {
  version: VERSION,
  id: uuid(),
  epoch: Date.now(),
  totalBandwidth: 0,
}

let pdfCachingMetrics

export function setCachingMetrics(metrics) {
  pdfCachingMetrics = metrics
}

const SAMPLING_RATE = 0.01

export function trackPdfDownload(response, compileTimeClientE2E) {
  const { serviceWorkerMetrics, stats, timings } = response

  const t0 = performance.now()
  let bandwidth = 0
  const deliveryLatencies = {
    compileTimeClientE2E,
    compileTimeServerE2E: timings?.compileE2E,
  }

  function firstRenderDone({ timePDFFetched, timePDFRendered }) {
    const latencyFetch = Math.ceil(timePDFFetched - t0)
    deliveryLatencies.latencyFetch = latencyFetch
    // The renderer does not yield in case the browser tab is hidden.
    // It will yield when the browser tab is visible again.
    // This will skew our performance metrics for rendering!
    // We are omitting the render time in case we detect this state.
    let latencyRender
    if (timePDFRendered) {
      latencyRender = Math.ceil(timePDFRendered - timePDFFetched)
      deliveryLatencies.latencyRender = latencyRender
    }
    done({ latencyFetch, latencyRender })
  }
  function updateConsumedBandwidth(bytes) {
    pdfJsMetrics.totalBandwidth += bytes - bandwidth
    bandwidth = bytes
  }
  let done
  const onFirstRenderDone = new Promise(resolve => {
    done = resolve
  })

  if (getMeta('ol-trackPdfDownload')) {
    // Submit latency along with compile context.
    onFirstRenderDone.then(({ latencyFetch, latencyRender }) => {
      submitCompileMetrics({
        latencyFetch,
        latencyRender,
        compileTimeClientE2E,
        stats,
        timings,
      })
    })
    if (getMeta('ol-pdfCachingMode') === 'service-worker') {
      // Submit (serviceWorker) bandwidth counter separate from compile context.
      submitPDFBandwidth({ pdfJsMetrics, serviceWorkerMetrics })
    }
  }

  return {
    deliveryLatencies,
    firstRenderDone,
    updateConsumedBandwidth,
  }
}

function submitCompileMetrics(metrics) {
  const { latencyFetch, latencyRender, compileTimeClientE2E } = metrics
  const leanMetrics = {
    version: VERSION,
    latencyFetch,
    latencyRender,
    compileTimeClientE2E,
    id: pdfJsMetrics.id,
    ...(pdfCachingMetrics || {}),
  }
  sl_console.log('/event/compile-metrics', JSON.stringify(metrics))
  sendMB('compile-metrics-v6', leanMetrics, SAMPLING_RATE)
}

function submitPDFBandwidth(metrics) {
  const metricsFlat = {}
  Object.entries(metrics).forEach(([section, items]) => {
    if (!items) return
    Object.entries(items).forEach(([key, value]) => {
      metricsFlat[section + '_' + key] = value
    })
  })
  const leanMetrics = {}
  Object.entries(metricsFlat).forEach(([metric, value]) => {
    if (
      [
        'serviceWorkerMetrics_id',
        'serviceWorkerMetrics_cachedBytes',
        'serviceWorkerMetrics_fetchedBytes',
        'serviceWorkerMetrics_requestedBytes',
        'serviceWorkerMetrics_version',
        'serviceWorkerMetrics_epoch',
      ].includes(metric)
    ) {
      leanMetrics[metric] = value
    }
  })
  if (Object.entries(leanMetrics).length === 0) {
    return
  }
  sl_console.log('/event/pdf-bandwidth', JSON.stringify(metrics))
  sendMB('pdf-bandwidth-v6', leanMetrics, SAMPLING_RATE)
}
