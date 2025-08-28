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
        this.streamRequest = null;
        this.audioBuffer = [];
        this.streamStartTime = null;
        this.refreshInterval = null;
        
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
                noiseSuppression: true,
                autoGainControl: true,
                sampleSize: 16
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
        this.streamRequest = {
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                languageCode: this.languageCode,
                enableAutomaticPunctuation: true,
                model: 'default',
                audioChannelCount: 1,
                profanityFilter: false
            },
            interimResults: true
        };
        
        this.createRecognizeStream();
    }
    
    createRecognizeStream() {
        if (this.recognizeStream) {
            this.recognizeStream.end();
            this.recognizeStream = null;
        }
        
        this.streamStartTime = Date.now();
        
        // Set up periodic refresh before 4-minute limit
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => {
            const elapsed = Date.now() - this.streamStartTime;
            if (elapsed > 230000) { // Refresh after 3:50 minutes
                console.log('Proactively refreshing stream before timeout...');
                this.restartStream();
            }
        }, 10000); // Check every 10 seconds
        
        this.recognizeStream = this.client
            .streamingRecognize(this.streamRequest)
            .on('error', (error) => {
                console.error('Speech recognition error:', error);
                // Only emit error if it's not a normal timeout
                if (!error.message.includes('deadline') && !error.message.includes('DEADLINE_EXCEEDED')) {
                    this.emit('error', error);
                } else {
                    console.log('Stream timeout - reconnecting...');
                    this.restartStream();
                }
            })
            .on('end', () => {
                console.log('Speech recognition stream ended');
                // Restart stream if still recording
                if (this.isRecording) {
                    console.log('Restarting stream for continuous recognition...');
                    this.restartStream();
                }
            })
            .on('data', (data) => {
                console.log('Speech recognition data received:', JSON.stringify(data, null, 2));
                if (data.results && data.results.length > 0) {
                    const result = data.results[0];
                    if (result.alternatives && result.alternatives.length > 0) {
                        const alternative = result.alternatives[0];
                        const transcript = alternative.transcript;
                        const confidence = alternative.confidence || 0;
                        
                        console.log('Transcript:', transcript, 'Final:', result.isFinal, 'Confidence:', confidence);
                        
                        // Emit all results without filtering
                        if (result.isFinal) {
                            this.emit('final', transcript);
                        } else {
                            this.emit('interim', transcript);
                        }
                    } else {
                        console.log('No alternatives in result');
                    }
                } else {
                    console.log('No results in data or empty results array');
                }
            });
        
        this.startAudioCapture();
    }
    
    restartStream() {
        // Small delay before reconnecting
        setTimeout(() => {
            if (this.isRecording) {
                console.log('Creating new recognition stream...');
                this.createRecognizeStream();
                // Process any buffered audio
                while (this.audioBuffer.length > 0) {
                    const chunk = this.audioBuffer.shift();
                    if (this.recognizeStream && !this.recognizeStream.destroyed) {
                        this.recognizeStream.write(chunk);
                    }
                }
            }
        }, 100);
    }
    
    async startAudioCapture() {
        try {
            const context = new AudioContext({ sampleRate: 16000 });
            console.log('AudioContext created with sample rate:', context.sampleRate);
            
            // Try to use AudioWorklet (modern approach)
            try {
                await context.audioWorklet.addModule('audio-processor.js');
                const source = context.createMediaStreamSource(this.audioStream);
                const processor = new AudioWorkletNode(context, 'audio-processor');
                
                let audioPacketCount = 0;
                processor.port.onmessage = (event) => {
                    if (event.data.type === 'audio' && this.recognizeStream && !this.recognizeStream.destroyed) {
                        try {
                            // Convert Float32Array to Int16Array for LINEAR16 encoding
                            const float32Buffer = new Float32Array(event.data.buffer);
                            const int16Buffer = new Int16Array(float32Buffer.length);
                            
                            let hasAudio = false;
                            let maxAmplitude = 0;
                            for (let i = 0; i < float32Buffer.length; i++) {
                                const sample = float32Buffer[i];
                                // Direct conversion without amplification
                                int16Buffer[i] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
                                const abs = Math.abs(sample);
                                if (abs > maxAmplitude) maxAmplitude = abs;
                                if (abs > 0.01) hasAudio = true;
                            }
                            
                            if (hasAudio && audioPacketCount++ % 100 === 0) {
                                console.log('AudioWorklet: Audio detected, packet count:', audioPacketCount);
                            }
                            
                            const audioData = Buffer.from(int16Buffer.buffer);
                            if (this.recognizeStream && !this.recognizeStream.destroyed) {
                                this.recognizeStream.write(audioData);
                            } else {
                                // Buffer audio during reconnection (max 1 second)
                                this.audioBuffer.push(audioData);
                                if (this.audioBuffer.length > 30) {
                                    this.audioBuffer.shift();
                                }
                            }
                        } catch (writeError) {
                            console.error('Error writing to recognition stream:', writeError);
                        }
                    }
                };
                
                source.connect(processor);
                processor.connect(context.destination);
                
                this.audioContext = context;
                this.audioProcessor = processor;
                console.log('Using AudioWorkletNode for audio capture');
            } catch (workletError) {
                // Fallback to ScriptProcessor if AudioWorklet fails
                console.log('AudioWorklet not available, using ScriptProcessor:', workletError.message);
                const source = context.createMediaStreamSource(this.audioStream);
                // Use 2048 buffer size for better real-time performance
                const processor = context.createScriptProcessor(2048, 1, 1);
                
                let packetCount = 0;
                let silenceCount = 0;
                processor.onaudioprocess = (event) => {
                    const inputBuffer = event.inputBuffer.getChannelData(0);
                    const outputBuffer = new Int16Array(inputBuffer.length);
                    
                    // Convert float32 to int16 - no amplification, direct conversion
                    let hasAudio = false;
                    let maxAmplitude = 0;
                    let sum = 0;
                    
                    for (let i = 0; i < inputBuffer.length; i++) {
                        const sample = inputBuffer[i];
                        // Direct conversion without amplification
                        outputBuffer[i] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
                        
                        const abs = Math.abs(sample);
                        sum += abs;
                        if (abs > maxAmplitude) maxAmplitude = abs;
                        if (abs > 0.01) hasAudio = true; // Use reasonable threshold
                    }
                    
                    const avgAmplitude = sum / inputBuffer.length;
                    
                    // Log audio activity periodically
                    if (hasAudio) {
                        silenceCount = 0;
                        if (packetCount++ % 50 === 0) {
                            console.log(`Audio detected - Max: ${maxAmplitude.toFixed(4)}, Avg: ${avgAmplitude.toFixed(6)}`);
                        }
                    } else {
                        silenceCount++;
                        if (silenceCount % 100 === 0) {
                            console.log(`Silence detected - Max: ${maxAmplitude.toFixed(4)}, Avg: ${avgAmplitude.toFixed(6)}`);
                        }
                    }
                    
                    // Always send audio data to maintain stream
                    const audioData = Buffer.from(outputBuffer.buffer);
                    if (this.recognizeStream && !this.recognizeStream.destroyed) {
                        try {
                            this.recognizeStream.write(audioData);
                        } catch (writeError) {
                            console.error('Error writing to recognition stream:', writeError);
                        }
                    } else if (this.isRecording) {
                        // Buffer audio during reconnection (max 1 second)
                        this.audioBuffer.push(audioData);
                        if (this.audioBuffer.length > 30) {
                            this.audioBuffer.shift();
                        }
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
        
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        
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