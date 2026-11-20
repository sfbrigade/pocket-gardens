import { Alert, Button, Fieldset, Radio, Stack, TextInput } from '@mantine/core';
import { isEmail, hasLength, useForm } from '@mantine/form';

function RegistrationForm ({ onSubmitMutation, initialEmail = '' }) {
  const form = useForm({
    initialValues: {
      firstName: '',
      lastName: '',
      email: initialEmail,
      password: '',
      registrationMethod: 'magic-link',
    },
    validate: {
      firstName: hasLength({ min: 2, max: 30 }, 'First name must be between 2 and 30 characters long.'),
      lastName: hasLength({ min: 2, max: 30 }, 'Last name must be between 2 and 30 characters long.'),
      email: isEmail('Please enter a valid email address.'),
      password: (value, values) => values.registrationMethod === 'password'
        ? hasLength({ min: 8, max: 128 }, 'Passwords must be between 8 and 128 characters.')(value)
        : null,
    },
  });

  function onSubmit (values) {
    onSubmitMutation.mutate(values, {
      onError: (errors) => form.setErrors(errors),
      onSettled: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
    });
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <Fieldset disabled={onSubmitMutation.isPending} variant='unstyled'>
        <Stack w={{ base: '100%', xs: 320 }}>
          {form.errors._form && <Alert color='red'>{form.errors._form}</Alert>}
          <TextInput
            {...form.getInputProps('firstName')}
            key={form.key('firstName')}
            label='First name'
            autoComplete='given-name'
          />
          <TextInput
            {...form.getInputProps('lastName')}
            key={form.key('lastName')}
            label='Last name'
            autoComplete='family-name'
          />
          <TextInput
            {...form.getInputProps('email')}
            key={form.key('email')}
            type='email'
            label='Email'
            autoComplete='email'
          />
          <Radio.Group
            label='Registration method'
            value={form.values.registrationMethod}
            onChange={(value) => {
              form.setFieldValue('registrationMethod', value);
              form.clearErrors();
              onSubmitMutation.reset();
            }}
          >
            <Stack mt='xs'>
              <Radio value='magic-link' label='Register with email link' />
              <Radio value='password' label='Register with password' />
              {form.values.registrationMethod === 'password' && (
                <TextInput
                  {...form.getInputProps('password')}
                  key={form.key('password')}
                  type='password'
                  label='Password'
                  autoComplete='new-password'
                />
              )}
            </Stack>
          </Radio.Group>
          <Button type='submit' loading={onSubmitMutation.isPending}>
            {form.values.registrationMethod === 'password' ? 'Register with password' : 'Email me a registration link'}
          </Button>
        </Stack>
      </Fieldset>
    </form>
  );
}

export default RegistrationForm;
