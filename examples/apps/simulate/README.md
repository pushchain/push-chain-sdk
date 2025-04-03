# Push Simulate Application

A simulation and testing platform built with React, TypeScript, and Vite, integrated with the Push Protocol. This application provides a sandbox environment for testing and simulating various blockchain interactions and Push Protocol features.

## 🚀 Features

- Interactive simulation environment
- Integration with Push Protocol for testing
- Form validation with Formik and Yup
- Real-time blockchain interaction simulation
- TypeScript for type safety
- Vite for fast development and building
- Devnet integration for testing

## 🛠️ Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Git

## 📦 Installation

1. First, build the shared components:

   ```bash
   cd packages/shared-components
   yarn install
   yarn build
   ```

2. Then, install and run the simulate application:

   ```bash
   cd ../../examples/apps/simulate
   yarn install
   ```

## 🏃‍♂️ Running the Application

### Development Mode

```bash
yarn dev
```

This will start the development server at `http://localhost:5173`

## 🛠️ Tech Stack

- React 18
- TypeScript
- Vite
- Push Protocol for testing
- Viem for Ethereum interactions
- Formik for form handling
- Yup for form validation
- React Router for navigation
- PushChain Devnet for testing

## 📚 Project Structure

```
simulate/
├── src/              # Source files
├── public/           # Static assets
├── vite.config.ts    # Vite configuration
└── package.json      # Project dependencies
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
