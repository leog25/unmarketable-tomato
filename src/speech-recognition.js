const { spawn, execSync } = require('child_process');
const speech = require('@google-cloud/speech');
const { EventEmitter } = require('events');

class SpeechRecognition extends EventEmitter {
    constructor(languageCode = 'en-US', deviceId = null) {
        super();
        
        this.languageCode = languageCode;
        this.deviceId = deviceId;
        this.deviceIndex = null;
        this.client = null;
        this.recognizeStream = null;
        this.recordProcess = null;
        this.isRecording = false;
        this.streamStartTime = null;
        this.refreshInterval = null;
        
        // Check if SOX is available
        this.soxAvailable = this.checkSoxAvailability();
        
        try {
            const clientOptions = {
                fallback: false,
                grpc: require('@grpc/grpc-js'),
                projectId: process.env.GOOGLE_CLOUD_PROJECT || 'sigma-future-467102-e0'
            };

            this.client = new speech.SpeechClient(clientOptions);
        } catch (error) {
            throw new Error('Google Cloud Speech credentials not configured. Please run: gcloud auth application-default login');
        }
    }
    
    async start() {
        try {
            if (!this.soxAvailable) {
                throw new Error('SOX is not installed. Please install SOX to use speech recognition.');
            }
            
            // Map device ID to index if needed
            if (this.deviceId) {
                this.deviceIndex = await this.getDeviceIndex(this.deviceId);
            }
            
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
                this.restartStream(request);
            }
        }, 10000);
        
        this.recognizeStream = this.client
            .streamingRecognize(request)
            .on('error', (error) => {
                if (!error.message.includes('deadline') && !error.message.includes('DEADLINE_EXCEEDED')) {
                    this.emit('error', new Error('Speech recognition failed'));
                } else {
                    this.restartStream(request);
                }
            })
            .on('end', () => {
                if (this.isRecording) {
                    this.restartStream(request);
                }
            })
            .on('data', (data) => {
                if (data.results && data.results.length > 0) {
                    const result = data.results[0];
                    if (result.alternatives && result.alternatives.length > 0) {
                        const transcript = result.alternatives[0].transcript;
                        const confidence = result.alternatives[0].confidence || 0;
                        
                        
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
    
    checkSoxAvailability() {
        try {
            execSync('sox --version', { stdio: 'ignore' });
            return true;
        } catch (error) {
            return false;
        }
    }
    
    async getDeviceIndex(deviceId) {
        // For Windows, we need to map the device ID to an index
        // SOX on Windows uses numeric indices for devices
        try {
            // Get list of audio input devices
            const devices = await this.listAudioDevices();
            const index = devices.findIndex(d => d.deviceId === deviceId);
            return index >= 0 ? index : null;
        } catch (error) {
            return null;
        }
    }
    
    async listAudioDevices() {
        // This would need to be implemented based on platform
        // For now, return empty array as SOX device selection is limited on Windows
        return [];
    }
    
    startRecording() {
        // Use sox directly with Windows audio input
        const soxArgs = [
            '-t', 'waveaudio',
        ];
        
        // Add device index if specified (0-based index for Windows)
        if (this.deviceIndex !== null) {
            soxArgs.push(`${this.deviceIndex}`);
        } else {
            soxArgs.push('-d'); // Default device
        }
        
        // Add audio format parameters
        soxArgs.push(
            '-r', '16000',             // Sample rate
            '-c', '1',                 // Mono
            '-e', 'signed-integer',    // Encoding
            '-b', '16',                // Bits
            '-t', 'wav',               // Output format
            '-'                        // Output to stdout
        );
        
        this.recordProcess = spawn('sox', soxArgs);
        
        this.recordProcess.stderr.on('data', (data) => {
            // Sox stderr output is mostly informational, ignore it
        });
        
        this.recordProcess.on('error', (error) => {
            this.emit('error', new Error('Recording failed. Please ensure SOX is installed and accessible.'));
        });
        
        this.recordProcess.on('exit', (code, signal) => {
            if (code !== 0 && code !== null && this.isRecording) {
                this.emit('error', new Error('Recording stopped unexpectedly'));
            }
        });
        
        // Pipe sox output to recognition stream
        if (this.recognizeStream) {
            this.recordProcess.stdout.pipe(this.recognizeStream);
        }
        
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