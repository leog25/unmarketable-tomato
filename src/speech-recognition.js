const speech = require('@google-cloud/speech');
const { EventEmitter } = require('events');
const path = require('path');

class SpeechRecognition extends EventEmitter {
    constructor(languageCode = 'en-US', deviceId = null) {
        super();
        
        this.languageCode = languageCode;
        this.deviceId = deviceId;
        this.client = null;
        this.recognizeStream = null;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.isRecording = false;
        
        try {
            // Modern credential methods (in order of preference):
            // 1. Workload Identity Federation (most secure, keyless)
            // 2. Environment variable GOOGLE_APPLICATION_CREDENTIALS
            // 3. gcloud CLI default credentials
            // 4. Service account key file
            
            // Force gRPC transport for streaming support
            const clientOptions = {
                // Disable fallback to REST, use gRPC only
                fallback: false,
                grpc: require('@grpc/grpc-js'),
                projectId: process.env.GOOGLE_CLOUD_PROJECT || 'sigma-future-467102-e0' // Your project ID from gcloud
            };

            // Try to use Application Default Credentials (ADC) first
            // This works with gcloud auth application-default login
            this.client = new speech.SpeechClient(clientOptions);
            
            console.log('Using Application Default Credentials (gcloud CLI or environment)');
        } catch (error) {
            console.error('Failed to initialize Google Cloud Speech client:', error.message);
            throw new Error(`Google Cloud Speech credentials not configured. 
Please run: gcloud auth application-default login
Or set GOOGLE_APPLICATION_CREDENTIALS environment variable to your service account key path`);
        }
    }
    
    async start() {
        try {
            this.audioStream = await this.getAudioStream();
            this.startRecognition();
            this.emit('start');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    async getAudioStream() {
        return new Promise((resolve, reject) => {
            const audioConstraints = {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            };
            
            // Add specific device if selected
            if (this.deviceId) {
                audioConstraints.deviceId = { exact: this.deviceId };
                console.log(`Using specific microphone: ${this.deviceId}`);
            } else {
                console.log('Using default microphone');
            }
            
            navigator.mediaDevices.getUserMedia({ 
                audio: audioConstraints
            })
            .then(stream => {
                console.log('Microphone stream obtained successfully');
                const mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm;codecs=opus'
                });
                
                this.mediaRecorder = mediaRecorder;
                resolve(stream);
            })
            .catch(error => {
                console.error('Microphone error:', error);
                reject(new Error(`Microphone access denied: ${error.message}`));
            });
        });
    }
    
    startRecognition() {
        const request = {
            config: {
                encoding: 'WEBM_OPUS',
                sampleRateHertz: 16000,
                languageCode: this.languageCode,
                enableAutomaticPunctuation: true,
                model: 'latest_long'
            },
            interimResults: true
        };
        
        this.recognizeStream = this.client
            .streamingRecognize(request)
            .on('error', (error) => {
                console.error('Speech recognition error:', error);
                this.emit('error', error);
            })
            .on('data', (data) => {
                console.log('Speech recognition data received:', JSON.stringify(data, null, 2));
                if (data.results && data.results.length > 0) {
                    const result = data.results[0];
                    const transcript = result.alternatives[0].transcript;
                    console.log('Transcript:', transcript, 'Final:', result.isFinal);
                    
                    if (result.isFinal) {
                        this.emit('final', transcript);
                    } else {
                        this.emit('interim', transcript);
                    }
                }
            });
        
        this.startAudioCapture();
    }
    
    async startAudioCapture() {
        try {
            const context = new AudioContext({ sampleRate: 16000 });
            
            // Try to use AudioWorklet (modern approach)
            try {
                await context.audioWorklet.addModule('audio-processor.js');
                const source = context.createMediaStreamSource(this.audioStream);
                const processor = new AudioWorkletNode(context, 'audio-processor');
                
                processor.port.onmessage = (event) => {
                    if (event.data.type === 'audio' && this.recognizeStream && !this.recognizeStream.destroyed) {
                        this.recognizeStream.write(Buffer.from(event.data.buffer));
                    }
                };
                
                source.connect(processor);
                processor.connect(context.destination);
                
                this.audioContext = context;
                this.audioProcessor = processor;
                console.log('Using AudioWorkletNode for audio capture');
            } catch (workletError) {
                // Fallback to ScriptProcessor if AudioWorklet fails
                console.log('AudioWorklet not available, using ScriptProcessor');
                const source = context.createMediaStreamSource(this.audioStream);
                const processor = context.createScriptProcessor(4096, 1, 1);
                
                let packetCount = 0;
                processor.onaudioprocess = (event) => {
                    const inputBuffer = event.inputBuffer.getChannelData(0);
                    const outputBuffer = new Int16Array(inputBuffer.length);
                    
                    // Check if we're getting audio
                    let hasAudio = false;
                    for (let i = 0; i < inputBuffer.length; i++) {
                        outputBuffer[i] = Math.max(-32768, Math.min(32767, inputBuffer[i] * 32768));
                        if (Math.abs(inputBuffer[i]) > 0.001) hasAudio = true;
                    }
                    
                    if (hasAudio && packetCount++ % 50 === 0) {
                        console.log('Audio detected, sending to Google Speech API...');
                    }
                    
                    if (this.recognizeStream && !this.recognizeStream.destroyed) {
                        this.recognizeStream.write(Buffer.from(outputBuffer.buffer));
                    }
                };
                
                source.connect(processor);
                processor.connect(context.destination);
                
                this.audioContext = context;
                this.audioProcessor = processor;
            }
            
            this.isRecording = true;
        } catch (error) {
            console.error('Failed to start audio capture:', error);
            throw error;
        }
    }
    
    stop() {
        this.isRecording = false;
        
        if (this.recognizeStream) {
            this.recognizeStream.end();
            this.recognizeStream = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }
        
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            this.mediaRecorder = null;
        }
        
        this.emit('stop');
    }
}

module.exports = SpeechRecognition;