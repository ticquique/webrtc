
'use strict'

interface RTCOptions {
    destination: HTMLVideoElement;
    start?: HTMLElement;
    stop?: HTMLElement;
    source?: HTMLVideoElement;
    debug?: boolean;
    offerOptions?: RTCOfferOptions;
    audio?: boolean;
    video?: boolean;
}


export default function (options: RTCOptions) {
    const {
        source,
        destination,
        start,
        stop,
        debug = false,
        audio = false,
        video = true
    } = options

    let pc: RTCPeerConnection | null = null

    const startRecording = async () => {
        pc = await startCamera(destination, source, debug, audio, video)
    }

    const stopRecording = () => {
        pc = pc ? stopCamera(pc, source) : pc
        pc = null
    }

    const createPeerConnection = (displayResult: HTMLVideoElement, debug?: boolean) => {
        const config = {
            sdpSemantics: 'unified-plan',
            iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
        }

        const pc = new RTCPeerConnection(config)

        if (debug) {
            console.log(pc.iceGatheringState)
            console.log(pc.iceConnectionState)
            console.log(pc.signalingState)
            pc.addEventListener('icegatheringstatechange', () => console.log(pc.iceGatheringState))
            pc.addEventListener('iceconnectionstatechange', () => console.log(pc.iceConnectionState))
            pc.addEventListener('signalingstatechange', () => console.log(pc.signalingState))
        }

        function onTrack(this: RTCPeerConnection, ev: RTCTrackEvent) {
            options.destination.srcObject = ev.streams[0]
        }

        pc.addEventListener('track', onTrack)
        return pc
    }

    const negotiate = async (pc: RTCPeerConnection, offerOptions: RTCOfferOptions) => {
        let offer = await pc.createOffer(offerOptions)
        await pc.setLocalDescription(offer)
        await new Promise((resolve) => {
            function checkState(this: RTCPeerConnection) {
                if (this.iceGatheringState === 'complete') {
                    this.removeEventListener('icegatheringstatechange', checkState)
                    resolve()
                }
            }
            if (pc.iceGatheringState === 'complete') resolve()
            else pc.addEventListener('icegatheringstatechange', checkState)
        });

        if (pc.localDescription) offer = offer = pc.localDescription
        offer.sdp = sdpFilterCodec('video', 'H264/90000', offer.sdp)

        const body = JSON.stringify({ sdp: offer.sdp, type: offer.type })
        const headers = { 'Content-Type': 'application/json' }
        const response = await fetch('/offer', { body, headers, method: 'POST' })
        pc.setRemoteDescription(await response.json())
        return pc
    }

    async function startCamera(displayResult: HTMLVideoElement, displaySource?: HTMLVideoElement, debug?: boolean, audio?: boolean, video?: boolean) {
        const pc = createPeerConnection(displayResult, debug)
        const constraints = { audio, video }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)

        if (displaySource) displaySource.srcObject = stream
        stream.getTracks().forEach((track) => pc.addTrack(track, stream))

        const offerOptions: RTCOfferOptions = {
            offerToReceiveVideo: video,
            offerToReceiveAudio: audio
        }

        return await negotiate(pc, offerOptions)
    }

    function stopCamera(pc: RTCPeerConnection, displaySource?: HTMLVideoElement) {
        if (displaySource) displaySource.srcObject = null
        const stopTransceiver = (transceiver: RTCRtpTransceiver) => { if (transceiver.stop) transceiver.stop() }
        if (pc.getTransceivers) {
            pc.getTransceivers().forEach(transceiver => stopTransceiver(transceiver))
        }
        pc.getSenders().forEach(sender => sender?.track?.stop())
        setTimeout(() => pc.close(), 500)
        return pc
    }

    function sdpFilterCodec(kind: 'video' | 'audio' = 'video', codec: 'H264/90000' = 'H264/90000', realSdp: string | undefined) {
        const rtxRegex = new RegExp('a=fmtp:(\\d+) apt=(\\d+)\r$')
        const codecRegex = new RegExp('a=rtpmap:([0-9]+) ' + escapeRegExp(codec))
        const videoRegex = new RegExp('(m=' + kind + ' .*?)( ([0-9]+))*\\s*$')
        const skipRegex = 'a=(fmtp|rtcp-fb|rtpmap):([0-9]+)'
        const lines = realSdp?.split('\n') ?? []

        let isKind = false
        const allowed = lines.reduce((old: number[], line: string) => {
            isKind = line.startsWith(`m=${kind} `) || (!line.startsWith('m=') && isKind)
            const matchCodex = line.match(codecRegex)
            const matchRegex = line.match(rtxRegex)
            if (matchCodex) old = [...old, +matchCodex[1]]
            if (matchRegex && old.includes(+matchRegex[2])) old = [...old, +matchRegex[1]]
            return old
        }, [])

        isKind = false

        return lines.reduce((old: string, line: string) => {
            isKind = line.startsWith(`m=${kind} `) || (!line.startsWith('m=') && isKind)
            const isIncluded = allowed.includes(+(line.match(skipRegex)?.[2] ?? NaN))
            const isVideo = line.match(videoRegex)
            return isKind ?
                isIncluded ?
                    isVideo ?
                        `${old}${line.replace(videoRegex, '$1' + allowed.join(' '))} \n`
                        : `${old}${line} \n` // kind, included, no video
                    : old // kind, not included
                : `${old}${line} \n` // no kind
        }, '')

    }

    const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string

    start?.addEventListener('click', () => pc ? stopRecording() : startRecording()) ?? startRecording()
    stop?.addEventListener('click', () => stopRecording())
}
