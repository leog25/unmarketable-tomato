const { spawn } = require('child_process');
const speech = require('@google-cloud/speech');
const { EventEmitter } = require('events');

class SpeechRecognition extends EventEmitter {
    constructor(languageCode = 'en-US', deviceId = null) {
        super();
        
        this.languageCode = languageCode;
        this.deviceId = deviceId;
        this.client = null;
        this.recognizeStream = null;
        this.recordProcess = null;
        this.isRecording = false;
        this.streamStartTime = null;
        this.refreshInterval = null;
        
        try {
            const clientOptions = {
                fallback: false,
                grpc: require('@grpc/grpc-js'),
                projectId: process.env.GOOGLE_CLOUD_PROJECT || 'sigma-future-467102-e0'
            };

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
            this.isRecording = true;
            this.startRecognition();
            this.startRecording();
            this.emit('start');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    
    startRecognition() {
        const request = {
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
        
        this.createRecognizeStream(request);
    }
    
    createRecognizeStream(request) {
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
                this.restartStream(request);
            }
        }, 10000);
        
        this.recognizeStream = this.client
            .streamingRecognize(request)
            .on('error', (error) => {
                console.error('Speech recognition error:', error);
                if (!error.message.includes('deadline') && !error.message.includes('DEADLINE_EXCEEDED')) {
                    this.emit('error', error);
                } else {
                    console.log('Stream timeout - reconnecting...');
                    this.restartStream(request);
                }
            })
            .on('end', () => {
                console.log('Speech recognition stream ended');
                if (this.isRecording) {
                    console.log('Restarting stream for continuous recognition...');
                    this.restartStream(request);
                }
            })
            .on('data', (data) => {
                if (data.results && data.results.length > 0) {
                    const result = data.results[0];
                    if (result.alternatives && result.alternatives.length > 0) {
                        const transcript = result.alternatives[0].transcript;
                        const confidence = result.alternatives[0].confidence || 0;
                        
                        console.log('Transcript:', transcript, 'Final:', result.isFinal, 'Confidence:', confidence);
                        
                        if (result.isFinal) {
                            this.emit('final', transcript);
                        } else {
                            this.emit('interim', transcript);
                        }
                    }
                }
            });
    }
    
    restartStream(request) {
        setTimeout(() => {
            if (this.isRecording) {
                console.log('Creating new recognition stream...');
                // Stop current recording
                if (this.recordProcess) {
                    this.recordProcess.stdout.unpipe();
                }
                // Create new stream and reconnect
                this.createRecognizeStream(request);
                if (this.recordProcess && !this.recordProcess.killed) {
                    this.recordProcess.stdout.pipe(this.recognizeStream);
                }
            }
        }, 100);
    }
    
    startRecording() {
        // Use sox directly with Windows audio input
        const soxArgs = [
            '-t', 'waveaudio', '-d',  // Windows audio input device
            '-r', '16000',             // Sample rate
            '-c', '1',                 // Mono
            '-e', 'signed-integer',    // Encoding
            '-b', '16',                // Bits
            '-t', 'wav',               // Output format
            '-'                        // Output to stdout
        ];
        
        if (this.deviceId) {
            // If specific device selected, add device selection
            // Note: This might need adjustment based on how sox handles device selection on Windows
            console.log(`Using device: ${this.deviceId}`);
        }
        
        console.log('Starting sox with args:', soxArgs.join(' '));
        this.recordProcess = spawn('sox', soxArgs);
        
        this.recordProcess.stderr.on('data', (data) => {
            const message = data.toString();
            // Only log if it's not just progress info
            if (!message.includes('In:') && !message.includes('Out:')) {
                console.log(`Sox: ${message}`);
            }
        });
        
        this.recordProcess.on('error', (error) => {
            console.error('Sox process error:', error);
            this.emit('error', new Error(`Recording failed: ${error.message}. Make sure sox is installed.`));
        });
        
        this.recordProcess.on('exit', (code, signal) => {
            if (code !== 0 && code !== null) {
                console.error(`Sox exited with code ${code}`);
                if (this.isRecording) {
                    this.emit('error', new Error(`Recording stopped unexpectedly with code ${code}`));
                }
            }
        });
        
        // Pipe sox output to recognition stream
        if (this.recognizeStream) {
            this.recordProcess.stdout.pipe(this.recognizeStream);
        }
        
        console.log('Recording started with sox');
    }
    
    stop() {
        this.isRecording = false;
        
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        
        if (this.recordProcess) {
            this.recordProcess.kill('SIGTERM');
            this.recordProcess = null;
        }
        
        if (this.recognizeStream) {
            this.recognizeStream.end();
            this.recognizeStream = null;
        }
        
        this.emit('stop');
    }
}

module.exports = SpeechRecognition;